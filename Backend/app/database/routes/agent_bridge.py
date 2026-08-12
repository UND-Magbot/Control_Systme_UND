"""로봇(Jetson 음성 에이전트) → 관제 호출 채널.

설계: 06_Planning/Standby-Voice-Integration-Plan.md S2

기존 `/DB/standby-call` 은 JWT(`require_permission("schedule-list")`)를 요구해서 **로봇이
부를 수단이 없었다**(G4). 사람이 브라우저에서 누르는 것과 로봇이 스스로 올리는 것은
인증 주체가 다르므로, JWT 경로를 건드리지 않고 **토큰 기반 경로를 따로** 연다.

인증: 헤더 `X-Agent-Token`. 값은 env `AGENT_TOKEN`.
  - 미설정이면 이 라우터는 **전부 503** 으로 닫힌다(기본 비활성 = 실수로 열리지 않는다).
  - 토큰은 로봇에 심어두는 값이라 사람 계정과 권한 체계가 다르다. 여기서 할 수 있는 일은
    **"지금 대기 중인 작업에 호출을 올리는 것"** 하나뿐이고, 그 외 조작은 열지 않는다.
"""
from __future__ import annotations

import os
import secrets

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database.models import RobotInfo, ScheduleInfo, VoiceConfirmWord, VoiceSlotValue
from app.database.routes import database, get_db
from app.logs.service import log_event
from app.scheduler import standby_session as sess_mod
from app.scheduler.loop import get_active_schedule_id, get_standby_state
from app.user_cache import get_robot_id, get_robot_name


def _destinations_for(db: Session, robot_id: int | None) -> list[str]:
    """로봇이 로컬 매칭에 참고할 목적지 표현들. 최종 판정은 서버가 한다."""
    if robot_id is None:
        return []
    out: list[str] = []
    for s in (db.query(VoiceSlotValue)
                .filter(VoiceSlotValue.RobotId == robot_id,
                        VoiceSlotValue.SlotName == "목적지",
                        VoiceSlotValue.LocationId.isnot(None))
                .all()):
        out.append(s.Value)
        out.extend(x.strip() for x in (s.Synonyms or "").split(",") if x.strip())
    return out


def _expected_token() -> str:
    return (os.getenv("AGENT_TOKEN") or "").strip()


def require_agent(x_agent_token: str | None = Header(default=None, alias="X-Agent-Token")) -> str:
    """에이전트 토큰 검사. 미설정이면 기능 자체를 닫는다."""
    expected = _expected_token()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="에이전트 채널이 비활성입니다(AGENT_TOKEN 미설정).",
        )
    if not x_agent_token or not secrets.compare_digest(x_agent_token, expected):
        raise HTTPException(status_code=401, detail="에이전트 토큰이 올바르지 않습니다.")
    return x_agent_token


@database.get("/agent/standby-context")
def agent_standby_context(
    db: Session = Depends(get_db),
    _: str = Depends(require_agent),
):
    """로봇이 "지금 들어도 되는가"를 판단하는 데 필요한 최소 정보.

    로봇은 이걸 주기적으로 폴링해서 **운영 시간 밖이나 응대 중에는 호출을 올리지 않는다.**
    (상시 청취가 아무 때나 세션을 열면 운영 시간 개념이 무너진다.)
    """
    state = get_standby_state()
    if not state:
        # 근무가 없어도 사람이 부르면 안내한다. 운영 시간표는 로봇을 쉬게 하려고
        # 있는 것이지 눈앞의 사람을 무시하라고 있는 게 아니다.
        # 다만 **다른 작업이 돌고 있으면 끼어들지 않는다** — 순회 중인 로봇을
        # 음성으로 가로채면 그 작업이 조용히 실패한다.
        busy_job = get_active_schedule_id() is not None
        busy_sess = sess_mod.is_active()
        return {
            "listening": not busy_job and not busy_sess,
            "reason": ("다른 작업을 수행 중입니다." if busy_job else
                       "이미 응대 중입니다." if busy_sess else None),
            "mode": "free",
            "robotName": get_robot_name(),
            "destinations": _destinations_for(db, get_robot_id()),
        }

    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == state["schedule_id"]).first()
    if not sched:
        return {"listening": False, "reason": "작업을 찾을 수 없습니다."}

    trigger = (getattr(sched, "StandbyTrigger", None) or "button").lower()
    phase = state.get("phase")
    busy = sess_mod.is_active()

    # 마이크 모드 + 대기장소 도착 + 응대 중이 아님 → 이때만 듣는다
    listening = (trigger == "mic") and (phase == "standby") and not busy
    reason = None
    if trigger != "mic":
        reason = f"호출 방식이 '{trigger}' 입니다."
    elif phase != "standby":
        reason = "대기 장소로 이동 중입니다."
    elif busy:
        reason = "이미 응대 중입니다."

    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.RobotName == sched.RobotName, RobotInfo.DeletedAt.is_(None))
        .first()
    )
    destinations = _destinations_for(db, robot.id if robot else None)

    return {
        "listening": listening,
        "reason": reason,
        "scheduleId": state["schedule_id"],
        "workName": state.get("work_name"),
        "robotName": state.get("robot_name"),
        "trigger": trigger,
        "phase": phase,
        # 로봇이 로컬 매칭에 참고할 수 있는 목록. 최종 판정은 서버가 한다.
        "destinations": destinations,
    }


class AgentCallReq(BaseModel):
    heard: str                  # STT 원문
    retryCount: int = 0         # 되묻기 후 재시도면 그 횟수


@database.post("/agent/standby-call")
def agent_standby_call(
    req: AgentCallReq,
    db: Session = Depends(get_db),
    _: str = Depends(require_agent),
):
    """로봇이 들은 말을 올린다. 목적지 판정·발화·이동·복귀는 서버가 한다.

    로봇은 "무엇을 들었는지"만 보고하고 **무엇을 할지는 정하지 않는다** — 그래야
    목적지 사전·화이트리스트·세션 기록이 한 곳(관제)에서 일관되게 적용된다.
    """
    state = get_standby_state()
    if not state:
        # 작업 없이 받은 호출 — 스케줄이 없으니 호출 방식·운영 시간 검사도 없다.
        if get_active_schedule_id() is not None:
            raise HTTPException(status_code=409, detail="다른 작업을 수행 중입니다.")
        return sess_mod.start_session(
            schedule_id=None, run_id=None, heard=req.heard, retry_count=req.retryCount,
        )

    sched = db.query(ScheduleInfo).filter(ScheduleInfo.id == state["schedule_id"]).first()
    if not sched:
        raise HTTPException(status_code=409, detail="작업을 찾을 수 없습니다.")

    trigger = (getattr(sched, "StandbyTrigger", None) or "button").lower()
    if trigger != "mic":
        # 운영자가 버튼 모드로 등록했으면 로봇이 멋대로 세션을 열지 않는다.
        raise HTTPException(status_code=409, detail="이 작업의 호출 방식은 마이크가 아닙니다.")
    if state.get("phase") != "standby":
        raise HTTPException(status_code=409, detail="대기 장소로 이동 중입니다.")

    return sess_mod.start_session(
        schedule_id=state["schedule_id"],
        run_id=state.get("run_id"),
        heard=req.heard,
        retry_count=req.retryCount,
    )


# ─────────────────────────────────────────────────────────
# 경유지 도착 확인 — 음성 채널 (PRD-Waypoint-Arrival-Interaction §6 ①)
#
# 상시대기(standby-context/standby-call)와 **같은 구조**로 연다:
#   로봇은 "지금 들어야 하는가"를 물어보고(context), "무엇을 들었는지"만 올린다(confirm).
#   긍정/부정 판정과 게이트 통과는 서버가 정한다 — 로봇이 정하면 규칙이 두 벌이 된다.
# ─────────────────────────────────────────────────────────

# 기본 인식어 — DB(voice_confirm_word)에 등록된 게 없을 때만 쓰는 폴백.
# 부분 문자열로 본다 — "이동" 하나면 "이동해줘"·"이동합시다" 가 모두 걸린다.
DEFAULT_ARRIVAL_AFFIRM = ("네", "예", "응", "그래", "맞아", "좋아", "확인", "이동", "출발",
                          "가자", "가주세요", "ok", "오케이", "yes")

# 안내를 마치고 돌아가도 되는지 — 도착 확인과 **섞으면 안 된다**.
# "없음" 이 도착 확인을 통과시키거나 "이동" 이 로봇을 돌려보내면 곤란하다.
# "없어" 는 "없어요"·"없어유" 를 함께 덮는다(부분 일치) — 따로 두지 않는다.
DEFAULT_DISMISS_WORDS = ("없어", "없음", "없습니다", "괜찮아", "괜찮습니다", "아니요",
                         "아니오", "아뇨", "끝", "다 했어", "됐어", "감사합니다",
                         "고맙습니다", "돌아가", "복귀")


def confirm_words(db: Session, robot_id: int | None, kind: str) -> tuple[str, ...]:
    """이 로봇의 인식어(종류별). 등록된 게 없으면 기본 목록으로 폴백한다.

    폴백이 있어야 테이블이 비어 있어도(신규 설치·마이그레이션 직후) 확인이 동작한다.
    """
    defaults = DEFAULT_DISMISS_WORDS if kind == "dismiss" else DEFAULT_ARRIVAL_AFFIRM
    if robot_id is None:
        return defaults
    rows = (
        db.query(VoiceConfirmWord)
        .filter(VoiceConfirmWord.RobotId == robot_id,
                VoiceConfirmWord.Kind == kind,
                VoiceConfirmWord.IsActive == 1)
        .order_by(VoiceConfirmWord.SortOrder, VoiceConfirmWord.id)
        .all()
    )
    words = tuple(r.Word.strip() for r in rows if (r.Word or "").strip())
    return words or defaults


def arrival_affirm_words(db: Session, robot_id: int | None) -> tuple[str, ...]:
    return confirm_words(db, robot_id, "arrival")


def _matches(heard: str, words: tuple[str, ...]) -> bool:
    """부분 문자열 대조 — '없음' 하나면 '없음요'·'특별히 없음' 이 모두 걸린다."""
    low = heard.lower()
    return any(w.lower() in low for w in words)


@database.get("/agent/arrival-context")
def agent_arrival_context(_: str = Depends(require_agent)):
    """로봇이 "지금 도착 확인을 들어야 하는가"를 묻는다.

    standby-context 와 같은 계약이다 — listening 이 True 일 때만 마이크를 연다.
    확인 방식이 button 이면 듣지 않는다(관제/현장 버튼이 통과시킨다).
    """
    from app.navigation.arrival_gate import gate_status

    st = gate_status()
    if not st.get("active"):
        return {"listening": False, "reason": "확인 대기 중인 도착 지점이 없습니다."}

    mode = st.get("confirmMode")
    if mode != "voice":
        return {"listening": False, "reason": f"확인 방식이 '{mode}' 입니다."}

    return {
        "listening": True,
        "wpName": st.get("wpName"),
        "announceText": st.get("announceText"),
        "waitedSec": st.get("waitedSec"),
        "remainingSec": st.get("remainingSec"),
        # 이 시간을 넘기면 관제가 작업을 중단시킨다 — 로봇이 무한정 듣지 않게 알려준다
        "hardCapRemainingSec": st.get("hardCapRemainingSec"),
    }


class AgentArrivalConfirmReq(BaseModel):
    heard: str | None = None   # STT 원문. 비면 판정 불가로 무시한다


@database.post("/agent/arrival-confirm")
def agent_arrival_confirm(
    req: AgentArrivalConfirmReq,
    db: Session = Depends(get_db),
    _: str = Depends(require_agent),
):
    """로봇이 들은 말을 올린다 → 서버가 긍정 판정 시 게이트를 통과시킨다.

    부정/무관한 말은 통과시키지 않고 계속 대기한다. 무응답 처리(onTimeout)는
    게이트가 이미 하고 있으므로 여기서 중단을 결정하지 않는다.
    """
    from app.navigation.arrival_gate import confirm_arrival, gate_status

    st = gate_status()
    if not st.get("active"):
        raise HTTPException(status_code=409, detail="확인 대기 중인 도착 지점이 없습니다.")
    if st.get("confirmMode") != "voice":
        raise HTTPException(status_code=409, detail="이 지점의 확인 방식은 음성이 아닙니다.")

    heard = (req.heard or "").strip()
    if not heard:
        return {"ok": False, "confirmed": False, "reason": "들은 말이 비어 있습니다."}

    words = confirm_words(db, st.get("robotId"), "arrival")
    if not _matches(heard, words):
        # 못 알아들은 것은 실패가 아니다 — 게이트는 계속 대기한다(재발화는 게이트가 한다).
        return {"ok": True, "confirmed": False, "heard": heard, "reason": "확인 의사로 판정하지 않았습니다."}

    ok = confirm_arrival(st.get("robotId"), by="voice")
    log_event("schedule", "arrival_confirmed_voice",
              f"도착 확인(음성): {st.get('wpName') or '경유지'}",
              detail=f"들은 말={heard}")
    return {"ok": True, "confirmed": ok, "heard": heard}


# ─────────────────────────────────────────────────────────
# 안내 종료(해산) 확인 — 목적지에 데려다준 뒤 돌아가도 되는지 묻는다.
#
# 예전에는 도착하자마자 돌아섰다. 사람이 번호표를 뽑거나 뭘 더 물어볼 틈이 없었다.
# 도착 확인 게이트와 **같은 계약**이되 대상이 다르다 — 저쪽은 경유지 통과,
# 이쪽은 응대 종료다. 인식어도 종류(`dismiss`)로 나뉜다.
# ─────────────────────────────────────────────────────────

@database.get("/agent/dismiss-context")
def agent_dismiss_context(_: str = Depends(require_agent)):
    """로봇이 "지금 해산 응답을 들어야 하는가"를 묻는다."""
    st = sess_mod.dismiss_status()
    if not st.get("active"):
        return {"listening": False, "reason": "안내 종료를 기다리는 응대가 없습니다."}
    return {
        "listening": True,
        "destName": st.get("destName"),
        "remainingSec": st.get("remainingSec"),
    }


class AgentDismissReq(BaseModel):
    heard: str | None = None


@database.post("/agent/dismiss-confirm")
def agent_dismiss_confirm(
    req: AgentDismissReq,
    db: Session = Depends(get_db),
    _: str = Depends(require_agent),
):
    """들은 말이 해산 의사면 복귀를 시작한다.

    아니면 그냥 계속 기다린다 — 추가 질문을 하려던 사람을 두고 떠나지 않는다.
    무응답 만료는 세션 tick 이 처리하므로 여기서 중단을 결정하지 않는다.
    """
    st = sess_mod.dismiss_status()
    if not st.get("active"):
        raise HTTPException(status_code=409, detail="안내 종료를 기다리는 응대가 없습니다.")

    heard = (req.heard or "").strip()
    if not heard:
        return {"ok": False, "confirmed": False, "reason": "들은 말이 비어 있습니다."}

    words = confirm_words(db, get_robot_id(), "dismiss")
    if not _matches(heard, words):
        return {"ok": True, "confirmed": False, "heard": heard,
                "reason": "해산 의사로 판정하지 않았습니다."}

    ok = sess_mod.confirm_dismiss(by="voice")
    log_event("schedule", "standby_dismiss_voice",
              f"안내 종료 확인(음성): {st.get('destName') or '목적지'}",
              detail=f"들은 말={heard}")
    return {"ok": True, "confirmed": ok, "heard": heard}
