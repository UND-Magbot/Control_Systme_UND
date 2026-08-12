"""음성 Q&A(FAQ·의도) 관리 — PRD-VOICE-FAQ.

설계 요지
- 원본(source of truth) = 관제 DB. 로봇은 동기화된 로컬 캐시를 읽는다(대화 중 DB 조회 없음).
- '저장'과 '로봇 적용'은 다르다. 저장은 DB, 적용은 로봇 반영(AppliedAt 갱신).
- 미리듣기/발화 렌더는 로봇에 위임한다. 관제에 한국어 처리를 두 벌 만들지 않는다.
"""

import csv
import io
import json
import re
from datetime import datetime
from difflib import SequenceMatcher

import requests
from fastapi import Depends, HTTPException, Request, UploadFile, File, Query
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session, selectinload

from app.auth.audit import write_audit, get_client_ip
from app.auth.dependencies import (
    require_permission,
    get_current_user,
    is_admin,
    get_business_robot_ids,
)
from app.database.models import (
    LocationInfo,
    ModuleVoiceInfo,
    RobotInfo,
    RobotModule,
    UserInfo,
    VoiceAnnouncement,
    VoiceConfig,
    VoiceConfirmWord,
    VoiceDialogLog,
    VoiceIntent,
    VoiceIntentExample,
    VoiceIntentResponse,
    VoiceSlotValue,
)
from app.database.routes import database, get_db

# ─────────────────────────────────────────────────────────
# 상한값 — DB 컬럼 길이 / UI maxLength / CSV 검증이 모두 여기를 본다.
# 한 곳이라도 어긋나면 "UI에선 됐는데 저장이 안 되는" 버그가 난다.
# ─────────────────────────────────────────────────────────
MAX_DISPLAY_NAME = 40
MAX_EXAMPLE_TEXT = 60
MAX_RESPONSE_TEXT = 400
MAX_SYNONYMS = 300
MAX_FALLBACK = 300
MIN_EXAMPLES, MAX_EXAMPLES = 2, 20
MIN_RESPONSES, MAX_RESPONSES = 1, 20
MAX_SEARCH = 40
MAX_ANNOUNCE_TEXT = 200   # 안내 멘트 발화 문구 (경유지 도착 상호작용)
MAX_ANNOUNCE_LABEL = 40
MAX_IMPORT_ROWS = 200
MAX_IMPORT_BYTES = 1 * 1024 * 1024   # 1MB — 200행짜리 CSV는 수십 KB다. 통째로 메모리에 읽으므로 상한을 둔다.

SLOT_NAME = "목적지"
SLOT_TOKEN = "{목적지}"
TOKEN_RE = re.compile(r"\{([^}]*)\}")

ACTION_LABELS = {"none": "없음", "navigate": "안내", "stop": "정지"}
LABEL_TO_ACTION = {v: k for k, v in ACTION_LABELS.items()}

# 유사 이름 정책 (§2.4) — 오인 이동을 막는 안전 요구사항
SIMILARITY_WARN = 0.75
SIMILARITY_BLOCK = 0.90

VOICE_AGENT_TIMEOUT = 10          # 헬스체크·프리뷰
VOICE_AGENT_SYNC_TIMEOUT = 600    # 합성이 길다(문장당 ~2.6초)


# ─────────────────────────────────────────────────────────
# 공통 헬퍼
# ─────────────────────────────────────────────────────────
def _get_robot_or_404(db: Session, robot_id: int, user: UserInfo) -> RobotInfo:
    """로봇 조회 + BusinessId 스코핑(이 프로젝트는 RLS가 아니라 수동 필터링이다)."""
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id, RobotInfo.DeletedAt.is_(None))
        .first()
    )
    if not robot:
        raise HTTPException(status_code=404, detail="로봇을 찾을 수 없습니다")
    if not is_admin(user) and user.BusinessId:
        if robot.id not in get_business_robot_ids(db, user.BusinessId):
            raise HTTPException(status_code=403, detail="다른 사업장의 로봇입니다")
    return robot


def _get_intent_or_404(db: Session, intent_id: int, user: UserInfo) -> VoiceIntent:
    intent = (
        db.query(VoiceIntent)
        .options(selectinload(VoiceIntent.examples), selectinload(VoiceIntent.responses))
        .filter(VoiceIntent.id == intent_id)
        .first()
    )
    if not intent:
        raise HTTPException(status_code=404, detail="시나리오를 찾을 수 없습니다")
    _get_robot_or_404(db, intent.RobotId, user)
    return intent


_CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"


def _to_jamo(text: str) -> str:
    """한글을 자모로 분해한다.

    음절 단위로 비교하면 '응급센터' vs '응급쎈터' 가 0.75 밖에 안 나온다(4글자 중 1글자 차이).
    그런데 STT 오인식은 '음소' 단위로 일어난다 — 센/쎈 은 초성 하나만 다르다.
    자모로 펴서 비교해야 사람이 느끼는 '닮음'과 유사도가 맞는다.
    """
    out = []
    for ch in text:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:
            idx = code - 0xAC00
            out.append(_CHO[idx // 588])
            out.append(_JUNG[(idx % 588) // 28])
            jong = _JONG[idx % 28]
            if jong != " ":
                out.append(jong)
        else:
            out.append(ch)
    return "".join(out)


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _to_jamo((a or "").strip()), _to_jamo((b or "").strip())).ratio()


def _split_synonyms(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]


def _get_or_create_config(db: Session, robot_id: int) -> VoiceConfig:
    cfg = db.query(VoiceConfig).filter(VoiceConfig.RobotId == robot_id).first()
    if not cfg:
        cfg = VoiceConfig(RobotId=robot_id)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def _mark_dirty(intent: VoiceIntent, user: UserInfo) -> None:
    """편집하면 '미적용' 상태가 된다 — AppliedAt 은 로봇 적용이 성공했을 때만 갱신한다."""
    intent.UpdatedBy = user.id
    intent.UpdatedAt = datetime.now()


def _is_applied(intent: VoiceIntent) -> bool:
    if not intent.AppliedAt:
        return False
    return intent.AppliedAt >= (intent.UpdatedAt or intent.CreatedAt)


def _voice_module(db: Session, robot_id: int) -> RobotModule | None:
    return (
        db.query(RobotModule)
        .filter(RobotModule.RobotId == robot_id, RobotModule.ModuleType == "voice")
        .first()
    )


def _agent_base_url(db: Session, robot: RobotInfo) -> str | None:
    """음성 에이전트 주소. 내장이면 로봇 IP, 외장이면 모듈에 등록된 Host (카메라와 같은 규칙)."""
    mod = _voice_module(db, robot.id)
    if not mod or not mod.IsActive:
        return None
    info = db.query(ModuleVoiceInfo).filter(ModuleVoiceInfo.ModuleId == mod.id).first()
    host = (info.Host if info and info.Host else None) or robot.RobotIP
    port = info.Port if info and info.Port else 8090
    if not host:
        return None
    return f"http://{host}:{port}"


def _validate_texts(display_name: str, examples: list, responses: list) -> None:
    """개수·글자수 상한 검증. 서버가 최종 방어선이다(클라 maxLength 는 UX일 뿐)."""
    name = (display_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="시나리오명을 입력하세요")
    if len(name) > MAX_DISPLAY_NAME:
        raise HTTPException(status_code=422, detail=f"시나리오명은 {MAX_DISPLAY_NAME}자 이하여야 합니다")

    if not (MIN_EXAMPLES <= len(examples) <= MAX_EXAMPLES):
        raise HTTPException(
            status_code=422,
            detail=f"질문은 {MIN_EXAMPLES}개 이상 {MAX_EXAMPLES}개 이하여야 합니다",
        )
    if not (MIN_RESPONSES <= len(responses) <= MAX_RESPONSES):
        raise HTTPException(
            status_code=422,
            detail=f"답변은 {MIN_RESPONSES}개 이상 {MAX_RESPONSES}개 이하여야 합니다",
        )

    for ex in examples:
        text = (ex.Text if hasattr(ex, "Text") else ex.text or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="빈 질문은 저장할 수 없습니다")
        if len(text) > MAX_EXAMPLE_TEXT:
            raise HTTPException(status_code=422, detail=f"질문은 {MAX_EXAMPLE_TEXT}자 이하여야 합니다")
        _assert_known_tokens(text, "질문")

    for rp in responses:
        text = (rp.Text if hasattr(rp, "Text") else rp.text or "").strip()
        if not text:
            raise HTTPException(status_code=422, detail="빈 답변은 저장할 수 없습니다")
        if len(text) > MAX_RESPONSE_TEXT:
            raise HTTPException(status_code=422, detail=f"답변은 {MAX_RESPONSE_TEXT}자 이하여야 합니다")
        _assert_known_tokens(text, "답변")


def _assert_known_tokens(text: str, where: str) -> None:
    """중괄호를 썼는데 알 수 없는 토큰이면 막는다.

    `{목적지 }`(공백)·`{목적}`(오타)는 매칭이 '조용히' 실패한다 — 저장 시점에 잡는다.
    토큰 없이 쓴 평범한 문장은 당연히 정상이다.
    """
    for m in TOKEN_RE.finditer(text or ""):
        if m.group(1) != SLOT_NAME:
            raise HTTPException(
                status_code=422,
                detail=f"{where}의 '{m.group(0)}' 는 사용할 수 없습니다. 목적지는 '{SLOT_TOKEN}' 하나뿐입니다.",
            )


def _next_intent_name(db: Session, robot_id: int) -> str:
    """엔진 키는 자동 생성한다. UI에 노출하지 않으므로 가독성이 필요 없다.
    한글 DisplayName 을 slug 로 변환하지 않는다 — 변환 규칙이 또 하나의 유지보수 대상이 된다."""
    n = db.query(VoiceIntent).filter(VoiceIntent.RobotId == robot_id).count() + 1
    while db.query(VoiceIntent.id).filter(
        VoiceIntent.RobotId == robot_id, VoiceIntent.Name == f"intent_{n}"
    ).first():
        n += 1
    return f"intent_{n}"


def _intent_row(intent: VoiceIntent, user_map: dict[int, str]) -> dict:
    return {
        "id": intent.id,
        "robotId": intent.RobotId,
        "displayName": intent.DisplayName,
        "actionType": intent.ActionType,
        "actionLabel": ACTION_LABELS.get(intent.ActionType, intent.ActionType),
        "exampleCount": len(intent.examples),
        "responseCount": len(intent.responses),
        "isActive": bool(intent.IsActive),
        "updatedBy": user_map.get(intent.UpdatedBy or 0),
        "updatedAt": intent.UpdatedAt.strftime("%Y-%m-%d %H:%M") if intent.UpdatedAt else None,
        "appliedAt": intent.AppliedAt.strftime("%Y-%m-%d %H:%M") if intent.AppliedAt else None,
        "isApplied": _is_applied(intent),
    }


def _intent_detail(intent: VoiceIntent) -> dict:
    return {
        "id": intent.id,
        "robotId": intent.RobotId,
        "displayName": intent.DisplayName,
        "actionType": intent.ActionType,
        "isActive": bool(intent.IsActive),
        "examples": [
            {"id": e.id, "text": e.Text, "isKeyword": bool(e.IsKeyword)}
            for e in intent.examples
        ],
        "responses": [{"id": r.id, "text": r.Text} for r in intent.responses],
        "isApplied": _is_applied(intent),
    }


# ─────────────────────────────────────────────────────────
# 시나리오 CRUD
# ─────────────────────────────────────────────────────────
class ExampleReq(BaseModel):
    text: str
    isKeyword: bool = False


class ResponseReq(BaseModel):
    text: str


class IntentReq(BaseModel):
    displayName: str
    actionType: str = "none"
    isActive: bool = True
    examples: list[ExampleReq] = Field(default_factory=list)
    responses: list[ResponseReq] = Field(default_factory=list)


def _list_intents(
    db: Session, current_user: UserInfo, robot_ids: list[int], search: str | None
) -> dict:
    q = (
        db.query(VoiceIntent)
        .options(selectinload(VoiceIntent.examples), selectinload(VoiceIntent.responses))
        .filter(VoiceIntent.RobotId.in_(robot_ids))
    )
    if search and search.strip():
        # % _ 를 그대로 넘기면 사용자가 의도하지 않은 와일드카드로 동작한다
        kw = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        q = q.filter(VoiceIntent.DisplayName.like(f"%{kw}%", escape="\\"))
    intents = q.order_by(VoiceIntent.RobotId, VoiceIntent.SortOrder, VoiceIntent.id).all()

    uids = {i.UpdatedBy for i in intents if i.UpdatedBy}
    user_map: dict[int, str] = {}
    if uids:
        for u in db.query(UserInfo).filter(UserInfo.id.in_(uids)).all():
            user_map[u.id] = u.UserName or u.LoginId or f"#{u.id}"

    return {
        "items": [_intent_row(i, user_map) for i in intents],
        "total": len(intents),
        "pendingCount": sum(0 if _is_applied(i) else 1 for i in intents),
    }


@database.get("/robots/{robot_id}/voice-intents")
def list_voice_intents(
    robot_id: int,
    search: str | None = Query(None, max_length=MAX_SEARCH),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    return _list_intents(db, current_user, [robot_id], search)


@database.get("/voice-intents/{intent_id}")
def get_voice_intent(
    intent_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    return _intent_detail(_get_intent_or_404(db, intent_id, current_user))


@database.post("/robots/{robot_id}/voice-intents")
def create_voice_intent(
    robot_id: int,
    req: IntentReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    if req.actionType not in ACTION_LABELS:
        raise HTTPException(status_code=422, detail="동작 값이 올바르지 않습니다")
    _validate_texts(req.displayName, req.examples, req.responses)

    name = req.displayName.strip()
    dup = (
        db.query(VoiceIntent.id)
        .filter(VoiceIntent.RobotId == robot_id, VoiceIntent.DisplayName == name)
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail=f"이미 '{name}' 시나리오가 있습니다")

    intent = VoiceIntent(
        RobotId=robot_id,
        Name=_next_intent_name(db, robot_id),
        DisplayName=name,
        ActionType=req.actionType,
        IsActive=1 if req.isActive else 0,
        UpdatedBy=current_user.id,
    )
    db.add(intent)
    db.flush()

    for idx, ex in enumerate(req.examples):
        db.add(VoiceIntentExample(
            IntentId=intent.id, Text=ex.text.strip(),
            IsKeyword=1 if ex.isKeyword else 0, SortOrder=idx,
        ))
    for idx, rp in enumerate(req.responses):
        db.add(VoiceIntentResponse(IntentId=intent.id, Text=rp.text.strip(), SortOrder=idx))

    db.commit()
    write_audit(db, current_user.id, "voice_intent_created", "voice", intent.id,
                detail=f"robot={robot_id} name={name}", ip_address=get_client_ip(request))
    return {"status": "ok", "id": intent.id}


@database.put("/voice-intents/{intent_id}")
def update_voice_intent(
    intent_id: int,
    req: IntentReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    intent = _get_intent_or_404(db, intent_id, current_user)
    if req.actionType not in ACTION_LABELS:
        raise HTTPException(status_code=422, detail="동작 값이 올바르지 않습니다")
    _validate_texts(req.displayName, req.examples, req.responses)

    name = req.displayName.strip()
    dup = (
        db.query(VoiceIntent.id)
        .filter(
            VoiceIntent.RobotId == intent.RobotId,
            VoiceIntent.DisplayName == name,
            VoiceIntent.id != intent.id,
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail=f"이미 '{name}' 시나리오가 있습니다")

    intent.DisplayName = name
    intent.ActionType = req.actionType
    intent.IsActive = 1 if req.isActive else 0
    _mark_dirty(intent, current_user)

    # 질문·답변은 통째로 교체한다(부분 diff 를 만들 이득이 없다)
    db.query(VoiceIntentExample).filter(VoiceIntentExample.IntentId == intent.id).delete()
    db.query(VoiceIntentResponse).filter(VoiceIntentResponse.IntentId == intent.id).delete()
    for idx, ex in enumerate(req.examples):
        db.add(VoiceIntentExample(
            IntentId=intent.id, Text=ex.text.strip(),
            IsKeyword=1 if ex.isKeyword else 0, SortOrder=idx,
        ))
    for idx, rp in enumerate(req.responses):
        db.add(VoiceIntentResponse(IntentId=intent.id, Text=rp.text.strip(), SortOrder=idx))

    db.commit()
    write_audit(db, current_user.id, "voice_intent_updated", "voice", intent.id,
                detail=f"name={name}", ip_address=get_client_ip(request))
    return {"status": "ok"}


@database.delete("/voice-intents/{intent_id}")
def delete_voice_intent(
    intent_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    intent = _get_intent_or_404(db, intent_id, current_user)
    name = intent.DisplayName
    db.delete(intent)
    db.commit()
    write_audit(db, current_user.id, "voice_intent_deleted", "voice", intent_id,
                detail=f"name={name}", ip_address=get_client_ip(request))
    return {"status": "ok"}


class BulkDeleteReq(BaseModel):
    ids: list[int]


@database.post("/voice-intents/bulk-delete")
def bulk_delete_voice_intents(
    req: BulkDeleteReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    if not req.ids:
        return {"status": "ok", "deleted": 0}
    intents = db.query(VoiceIntent).filter(VoiceIntent.id.in_(req.ids)).all()
    for intent in intents:
        _get_robot_or_404(db, intent.RobotId, current_user)   # 사업장 스코핑
        db.delete(intent)
    db.commit()
    write_audit(db, current_user.id, "voice_intent_deleted", "voice", None,
                detail=f"bulk ids={req.ids}", ip_address=get_client_ip(request))
    return {"status": "ok", "deleted": len(intents)}


# ─────────────────────────────────────────────────────────
# 목적지 사전
# ─────────────────────────────────────────────────────────
class SlotReq(BaseModel):
    value: str
    synonyms: str | None = None
    locationId: int | None = None
    keepOldNameAsSynonym: bool = False   # 이름 변경 시 '조용한 퇴행' 방지


def _slot_row(slot: VoiceSlotValue, place_map: dict[int, str]) -> dict:
    return {
        "id": slot.id,
        "value": slot.Value,
        "synonyms": slot.Synonyms or "",
        "locationId": slot.LocationId,
        "locationName": place_map.get(slot.LocationId or 0),
    }


@database.get("/robots/{robot_id}/voice-slots")
def list_voice_slots(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    robot = _get_robot_or_404(db, robot_id, current_user)
    slots = (
        db.query(VoiceSlotValue)
        .filter(VoiceSlotValue.RobotId == robot_id, VoiceSlotValue.SlotName == SLOT_NAME)
        .order_by(VoiceSlotValue.Value)
        .all()
    )

    loc_ids = {s.LocationId for s in slots if s.LocationId}
    place_map: dict[int, str] = {}
    if loc_ids:
        for p in db.query(LocationInfo).filter(LocationInfo.id.in_(loc_ids)).all():
            place_map[p.id] = p.LacationName

    # 연결 후보: 이 로봇의 현재 맵에 있는 장소만(다른 층·다른 건물이 섞이면 오연결)
    places_q = db.query(LocationInfo).filter(
        (LocationInfo.Category != "danger") | (LocationInfo.Category.is_(None))
    )
    if robot.CurrentMapId:
        places_q = places_q.filter(LocationInfo.MapId == robot.CurrentMapId)
    places = [
        {
            "id": p.id,
            "name": p.LacationName,
            "x": p.LocationX,
            "y": p.LocationY,
            "floorId": p.FloorId,
        }
        for p in places_q.order_by(LocationInfo.LacationName).all()
    ]

    return {
        "items": [_slot_row(s, place_map) for s in slots],
        "places": places,
        "total": len(slots),
        "linkedCount": sum(1 for s in slots if s.LocationId),
    }


def _check_similar_names(
    db: Session, robot_id: int, value: str, exclude_id: int | None = None
) -> dict | None:
    """유사 이름 충돌 검사 (§2.4).

    퍼지 매칭이 STT 오인식을 흡수하는 대신, 이름이 서로 닮으면 '오인 이동'이 된다.
    CLOi 같은 제품은 말만 틀리지만 우리는 환자를 엉뚱한 곳으로 데려간다.
    """
    target = (value or "").strip()
    if not target:
        return None

    rows = db.query(VoiceSlotValue).filter(
        VoiceSlotValue.RobotId == robot_id, VoiceSlotValue.SlotName == SLOT_NAME
    )
    if exclude_id:
        rows = rows.filter(VoiceSlotValue.id != exclude_id)

    worst = None
    for s in rows.all():
        candidates = [(s.Value, "목적지")] + [(syn, "동의어") for syn in _split_synonyms(s.Synonyms)]
        for cand, kind in candidates:
            score = _similarity(target, cand)
            if worst is None or score > worst["score"]:
                worst = {"score": score, "against": cand, "kind": kind, "slotId": s.id,
                         "slotValue": s.Value}

    if not worst or worst["score"] < SIMILARITY_WARN:
        return None
    worst["level"] = "block" if worst["score"] >= SIMILARITY_BLOCK else "warn"
    return worst


@database.post("/robots/{robot_id}/voice-slots/check")
def check_voice_slot(
    robot_id: int,
    req: SlotReq,
    excludeId: int | None = None,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    conflict = _check_similar_names(db, robot_id, req.value, excludeId)
    return {"conflict": conflict}


@database.post("/robots/{robot_id}/voice-slots")
def create_voice_slot(
    robot_id: int,
    req: SlotReq,
    request: Request,
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    value = (req.value or "").strip()
    if not value:
        raise HTTPException(status_code=422, detail="목적지를 입력하세요")
    if len(req.synonyms or "") > MAX_SYNONYMS:
        raise HTTPException(status_code=422, detail=f"동의어는 {MAX_SYNONYMS}자 이하여야 합니다")

    # 정확히 같은 목적지명은 '유사'가 아니라 '중복'으로 명확히 막는다
    if db.query(VoiceSlotValue).filter(
        VoiceSlotValue.RobotId == robot_id,
        VoiceSlotValue.SlotName == SLOT_NAME,
        VoiceSlotValue.Value == value,
    ).first():
        raise HTTPException(status_code=409, detail=f"이미 '{value}' 목적지가 있습니다.")

    conflict = _check_similar_names(db, robot_id, value)
    if conflict and conflict["level"] == "block":
        raise HTTPException(
            status_code=409,
            detail=f"기존 {conflict['kind']} '{conflict['against']}'와 "
                   f"{round(conflict['score'] * 100)}% 유사해 등록할 수 없습니다. 동의어로 추가하세요.",
        )
    if conflict and not force:
        return {"status": "conflict", "conflict": conflict}

    slot = VoiceSlotValue(
        RobotId=robot_id, SlotName=SLOT_NAME, Value=value,
        Synonyms=(req.synonyms or "").strip() or None, LocationId=req.locationId,
    )
    db.add(slot)
    db.commit()
    write_audit(db, current_user.id, "voice_slot_created", "voice", slot.id,
                detail=f"robot={robot_id} value={value}", ip_address=get_client_ip(request))
    return {"status": "ok", "id": slot.id}


@database.put("/voice-slots/{slot_id}")
def update_voice_slot(
    slot_id: int,
    req: SlotReq,
    request: Request,
    force: bool = False,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    slot = db.query(VoiceSlotValue).filter(VoiceSlotValue.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="목적지를 찾을 수 없습니다")
    _get_robot_or_404(db, slot.RobotId, current_user)

    value = (req.value or "").strip()
    if not value:
        raise HTTPException(status_code=422, detail="목적지를 입력하세요")

    old_value = slot.Value
    synonyms = _split_synonyms(req.synonyms)

    # 이름을 바꾸면 로봇은 예전 이름을 못 알아듣는다 — 사람들은 여전히 그렇게 부르는데.
    if req.keepOldNameAsSynonym and old_value != value and old_value not in synonyms:
        synonyms.insert(0, old_value)

    synonyms_str = ",".join(synonyms)
    if len(synonyms_str) > MAX_SYNONYMS:
        raise HTTPException(status_code=422, detail=f"동의어는 {MAX_SYNONYMS}자 이하여야 합니다")

    if value != old_value:
        # 정확히 같은 목적지명은 '유사'가 아니라 '중복'으로 명확히 막는다
        if db.query(VoiceSlotValue).filter(
            VoiceSlotValue.RobotId == slot.RobotId,
            VoiceSlotValue.SlotName == SLOT_NAME,
            VoiceSlotValue.Value == value,
            VoiceSlotValue.id != slot.id,
        ).first():
            raise HTTPException(status_code=409, detail=f"이미 '{value}' 목적지가 있습니다.")

        conflict = _check_similar_names(db, slot.RobotId, value, exclude_id=slot.id)
        if conflict and conflict["level"] == "block":
            raise HTTPException(
                status_code=409,
                detail=f"기존 {conflict['kind']} '{conflict['against']}'와 "
                       f"{round(conflict['score'] * 100)}% 유사해 사용할 수 없습니다.",
            )
        if conflict and not force:
            return {"status": "conflict", "conflict": conflict}

    slot.Value = value
    slot.Synonyms = synonyms_str or None
    slot.LocationId = req.locationId
    db.commit()
    write_audit(db, current_user.id, "voice_slot_updated", "voice", slot.id,
                detail=f"{old_value} -> {value}", ip_address=get_client_ip(request))
    return {"status": "ok"}


@database.delete("/voice-slots/{slot_id}")
def delete_voice_slot(
    slot_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    slot = db.query(VoiceSlotValue).filter(VoiceSlotValue.id == slot_id).first()
    if not slot:
        raise HTTPException(status_code=404, detail="목적지를 찾을 수 없습니다")
    _get_robot_or_404(db, slot.RobotId, current_user)

    value = slot.Value
    db.delete(slot)
    db.commit()
    write_audit(db, current_user.id, "voice_slot_deleted", "voice", slot_id,
                detail=f"value={value}", ip_address=get_client_ip(request))
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────
# 안내 멘트 (경유지 도착 상호작용) — 순수 발화 문구 라이브러리 (로봇별)
# 시나리오와 별 유형: 질문·매칭 없음. 경로 정지 옵션이 announceId 로 참조한다.
# PRD-Waypoint-Arrival-Interaction §8.0
# ─────────────────────────────────────────────────────────
class AnnounceReq(BaseModel):
    # 발화명(label) = 정지 옵션 드롭다운에 보이는 이름. 필수·로봇별 유일.
    label: str = Field(min_length=1, max_length=MAX_ANNOUNCE_LABEL)
    text: str = Field(min_length=1, max_length=MAX_ANNOUNCE_TEXT)
    isActive: bool = True


def _announce_row(a: VoiceAnnouncement) -> dict:
    # 편집 후 아직 로봇에 반영 안 됐으면 미적용
    applied = bool(a.AppliedAt and a.UpdatedAt and a.AppliedAt >= a.UpdatedAt)
    return {
        "id": a.id,
        "text": a.Text,
        "label": a.Label or "",
        "isActive": bool(a.IsActive),
        "applied": applied,
    }


@database.get("/robots/{robot_id}/voice-announcements")
def list_voice_announcements(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    rows = (
        db.query(VoiceAnnouncement)
        .filter(VoiceAnnouncement.RobotId == robot_id)
        .order_by(VoiceAnnouncement.SortOrder, VoiceAnnouncement.id)
        .all()
    )
    return {"items": [_announce_row(a) for a in rows]}


@database.post("/robots/{robot_id}/voice-announcements")
def create_voice_announcement(
    robot_id: int,
    req: AnnounceReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    label_val = (req.label or "").strip()
    text_val = req.text.strip()
    if not label_val:
        raise HTTPException(status_code=422, detail="발화명을 입력하세요")
    if not text_val:
        raise HTTPException(status_code=422, detail="발화 문구를 입력하세요")

    # 발화명은 드롭다운에 보이는 이름이라 유일해야 한다(같은 이름 두 개면 구분 불가)
    if db.query(VoiceAnnouncement).filter(
        VoiceAnnouncement.RobotId == robot_id,
        VoiceAnnouncement.Label == label_val,
    ).first():
        raise HTTPException(status_code=409, detail=f"이미 '{label_val}' 발화명이 있습니다.")
    # 같은 문구가 이름만 다르게 중복되는 것도 막는다(라이브러리가 지저분해진다)
    if db.query(VoiceAnnouncement).filter(
        VoiceAnnouncement.RobotId == robot_id,
        VoiceAnnouncement.Text == text_val,
    ).first():
        raise HTTPException(status_code=409, detail="같은 발화 문구가 이미 있습니다.")

    last = (
        db.query(VoiceAnnouncement.SortOrder)
        .filter(VoiceAnnouncement.RobotId == robot_id)
        .order_by(VoiceAnnouncement.SortOrder.desc())
        .first()
    )
    ann = VoiceAnnouncement(
        RobotId=robot_id,
        Text=text_val,
        Label=(req.label or "").strip() or None,
        IsActive=1 if req.isActive else 0,
        SortOrder=(last[0] + 1) if last else 0,
        UpdatedBy=current_user.id,
    )
    db.add(ann)
    db.commit()
    write_audit(db, current_user.id, "voice_announcement_created", "voice", ann.id,
                detail=f"robot={robot_id} text={text_val}", ip_address=get_client_ip(request))
    return {"status": "ok", "id": ann.id}


@database.put("/voice-announcements/{ann_id}")
def update_voice_announcement(
    ann_id: int,
    req: AnnounceReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    ann = db.query(VoiceAnnouncement).filter(VoiceAnnouncement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="안내 멘트를 찾을 수 없습니다")
    _get_robot_or_404(db, ann.RobotId, current_user)

    label_val = (req.label or "").strip()
    text_val = req.text.strip()
    if not label_val:
        raise HTTPException(status_code=422, detail="발화명을 입력하세요")
    if not text_val:
        raise HTTPException(status_code=422, detail="발화 문구를 입력하세요")
    if db.query(VoiceAnnouncement).filter(
        VoiceAnnouncement.RobotId == ann.RobotId,
        VoiceAnnouncement.Label == label_val,
        VoiceAnnouncement.id != ann.id,
    ).first():
        raise HTTPException(status_code=409, detail=f"이미 '{label_val}' 발화명이 있습니다.")
    if db.query(VoiceAnnouncement).filter(
        VoiceAnnouncement.RobotId == ann.RobotId,
        VoiceAnnouncement.Text == text_val,
        VoiceAnnouncement.id != ann.id,
    ).first():
        raise HTTPException(status_code=409, detail="같은 발화 문구가 이미 있습니다.")

    ann.Text = text_val
    ann.Label = label_val
    ann.IsActive = 1 if req.isActive else 0
    ann.UpdatedBy = current_user.id
    db.commit()
    write_audit(db, current_user.id, "voice_announcement_updated", "voice", ann.id,
                detail=f"text={text_val}", ip_address=get_client_ip(request))
    return {"status": "ok"}


@database.delete("/voice-announcements/{ann_id}")
def delete_voice_announcement(
    ann_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    ann = db.query(VoiceAnnouncement).filter(VoiceAnnouncement.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="안내 멘트를 찾을 수 없습니다")
    _get_robot_or_404(db, ann.RobotId, current_user)

    text_val = ann.Text
    db.delete(ann)
    db.commit()
    # 삭제된 멘트를 참조하던 경유지는 재적용 시 '발화 없음'으로 처리된다(PRD §9 E8).
    write_audit(db, current_user.id, "voice_announcement_deleted", "voice", ann_id,
                detail=f"text={text_val}", ip_address=get_client_ip(request))
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────
# 경유지 도착 확인 — [확인] 버튼 채널 (PRD-Waypoint-Arrival-Interaction §6 ②)
# 로봇이 경유지에서 발화 후 대기 중일 때, 현장/관제가 이걸 눌러 다음 이동을 허가한다.
# ─────────────────────────────────────────────────────────
@database.post("/robots/{robot_id}/arrival-confirm")
def confirm_arrival_gate(
    robot_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    from app.navigation.arrival_gate import confirm_arrival
    ok = confirm_arrival(robot_id)
    if ok:
        write_audit(db, current_user.id, "voice_arrival_confirmed", "voice", robot_id,
                    detail="경유지 도착 확인", ip_address=get_client_ip(request))
    # 대기 중인 게이트가 없으면 no_gate (오류 아님 — 이미 지나갔거나 확인 불필요한 지점)
    return {"status": "ok" if ok else "no_gate", "confirmed": ok}


# ─────────────────────────────────────────────────────────
# 음성 모듈 등록 (관리자 전용)
#
# 'RobotType 으로 추정'하지 않는다. 실제 RobotType 은 '기본 4족' 같은 자유 문자열이고,
# 같은 기종이라도 음성 하드웨어가 있을 수도 없을 수도 있다.
# 카메라와 같은 구조(RobotModule + 상세 테이블)로, 운영자가 명시적으로 등록한다.
# ─────────────────────────────────────────────────────────
DEFAULT_VOICE_PORT = 8090


class VoiceModuleReq(BaseModel):
    isActive: bool = True
    isBuiltIn: bool = True          # 내장이면 로봇 IP를 쓴다(Host 비움)
    host: str | None = None         # 외장 음성 박스의 IP
    port: int = DEFAULT_VOICE_PORT
    # 능력 플래그 — 상시 대기의 호출 방식(mic/button) 게이팅에 쓰인다.
    # 마이크가 없으면 'mic' 를 고를 수 없다(PRD-Schedule-Execution §3.6).
    #
    # None = "이번 요청은 이 값을 건드리지 않는다". 기본값을 bool 로 두면 필드를
    # 안 보낸 클라이언트가 저장할 때마다 기존 값을 덮어쓴다 — 실제로 프론트가
    # 이 둘을 안 보내서 저장 한 번에 HasMic 이 0 으로 돌아갔다(2026-08-10).
    hasMic: bool | None = None
    hasSpeaker: bool | None = None


@database.get("/robots/{robot_id}/voice-module")
def get_voice_module(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    robot = _get_robot_or_404(db, robot_id, current_user)
    mod = _voice_module(db, robot_id)
    if not mod:
        return {"exists": False, "canEdit": current_user.Permission in (1, 2)}

    info = db.query(ModuleVoiceInfo).filter(ModuleVoiceInfo.ModuleId == mod.id).first()
    return {
        "exists": True,
        "isActive": bool(mod.IsActive),
        "isBuiltIn": bool(mod.IsBuiltIn),
        "host": info.Host if info else None,
        "port": info.Port if info else DEFAULT_VOICE_PORT,
        "effectiveHost": (info.Host if info and info.Host else None) or robot.RobotIP,
        "hasMic": bool(info.HasMic) if info else False,
        "hasSpeaker": bool(info.HasSpeaker) if info else True,
        "canEdit": current_user.Permission in (1, 2),
    }


@database.put("/robots/{robot_id}/voice-module")
def upsert_voice_module(
    robot_id: int,
    req: VoiceModuleReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    if current_user.Permission not in (1, 2):
        raise HTTPException(status_code=403, detail="음성 모듈은 관리자만 등록할 수 있습니다")
    robot = _get_robot_or_404(db, robot_id, current_user)

    host = (req.host or "").strip() or None
    if not req.isBuiltIn and not host:
        raise HTTPException(status_code=422, detail="외장 음성 모듈은 접속 주소가 필요합니다")
    if req.isBuiltIn:
        host = None                     # 내장은 로봇 IP를 쓴다(카메라와 같은 규칙)
        if not robot.RobotIP:
            raise HTTPException(status_code=422, detail="로봇 IP가 없어 내장 모듈을 쓸 수 없습니다")
    if not (1 <= req.port <= 65535):
        raise HTTPException(status_code=422, detail="포트 범위가 올바르지 않습니다")

    mod = _voice_module(db, robot_id)
    if not mod:
        mod = RobotModule(
            RobotId=robot_id, ModuleType="voice", Label="음성",
            IsBuiltIn=1 if req.isBuiltIn else 0, IsActive=1 if req.isActive else 0,
            SortOrder=90,
        )
        db.add(mod)
        db.flush()
    else:
        mod.IsBuiltIn = 1 if req.isBuiltIn else 0
        mod.IsActive = 1 if req.isActive else 0

    info = db.query(ModuleVoiceInfo).filter(ModuleVoiceInfo.ModuleId == mod.id).first()
    if not info:
        # 신규 등록: 안 보내면 마이크 없음/스피커 있음(하드웨어 기본 가정)
        db.add(ModuleVoiceInfo(ModuleId=mod.id, Host=host, Port=req.port,
                               HasMic=1 if req.hasMic else 0,
                               HasSpeaker=0 if req.hasSpeaker is False else 1))
    else:
        info.Host = host
        info.Port = req.port
        # 안 보낸 필드는 건드리지 않는다 — 폼에 없는 값이 저장 때마다 리셋되면
        # 상시 대기 호출 방식이 조용히 button 으로 고정된다.
        if req.hasMic is not None:
            info.HasMic = 1 if req.hasMic else 0
        if req.hasSpeaker is not None:
            info.HasSpeaker = 1 if req.hasSpeaker else 0

    # 모듈을 처음 등록했는데 시나리오가 하나도 없으면 기본 3종을 넣어준다
    # (빈 화면에서 시작하면 무엇을 만들어야 할지 알기 어렵다)
    seeded = 0
    if not db.query(VoiceIntent).filter(VoiceIntent.RobotId == robot_id).first():
        for order, spec in enumerate(DEFAULT_INTENTS):
            intent = VoiceIntent(
                RobotId=robot_id, Name=spec["name"], DisplayName=spec["display"],
                ActionType=spec["action"], IsActive=1, SortOrder=order,
            )
            db.add(intent)
            db.flush()
            for i, text_ in enumerate(spec["examples"]):
                db.add(VoiceIntentExample(
                    IntentId=intent.id, Text=text_,
                    IsKeyword=1 if text_ in spec["keywords"] else 0, SortOrder=i,
                ))
            for i, text_ in enumerate(spec["responses"]):
                db.add(VoiceIntentResponse(IntentId=intent.id, Text=text_, SortOrder=i))
            seeded += 1

    db.commit()
    write_audit(db, current_user.id, "voice_module_updated", "voice", robot_id,
                detail=f"builtIn={req.isBuiltIn} host={host} port={req.port}",
                ip_address=get_client_ip(request))
    return {"status": "ok", "seededIntents": seeded}


# 기본 시나리오 (질문 2개 이상 · 답변 1개 이상 — 최소 제약을 시드가 스스로 위반하면 안 된다)
DEFAULT_INTENTS = [
    {
        "name": "navigate", "display": "길 안내", "action": "navigate",
        "examples": ["{목적지}로 안내해줘", "{목적지} 어디야", "{목적지} 가자", "{목적지}"],
        "keywords": ["{목적지}"],
        "responses": ["{목적지}로 안내하겠습니다. 따라와 주세요."],
    },
    {
        "name": "stop", "display": "정지", "action": "stop",
        "examples": ["멈춰", "정지", "스톱", "그만"],
        "keywords": ["멈춰", "정지", "스톱", "그만"],
        "responses": ["멈추겠습니다."],
    },
    {
        "name": "greeting", "display": "인사", "action": "none",
        "examples": ["안녕", "안녕하세요", "반가워"],
        "keywords": ["안녕"],
        "responses": ["안녕하세요. 무엇을 도와드릴까요?", "안녕하세요. 어디로 안내해 드릴까요?"],
    },
]


# ─────────────────────────────────────────────────────────
# 설정 (수정은 관리자 전용 — 잘못 만지면 인식률이 붕괴하는데 되돌릴 방법이 없다)
# ─────────────────────────────────────────────────────────
class ConfigReq(BaseModel):
    fallbackResponse: str
    matchThreshold: float
    slotFuzzyThreshold: float
    confirmOnAction: bool


@database.get("/robots/{robot_id}/voice-config")
def get_voice_config(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    cfg = _get_or_create_config(db, robot_id)
    return {
        "fallbackResponse": cfg.FallbackResponse,
        "matchThreshold": cfg.MatchThreshold,
        "slotFuzzyThreshold": cfg.SlotFuzzyThreshold,
        "confirmOnAction": bool(cfg.ConfirmOnAction),
        "canEdit": current_user.Permission in (1, 2),
    }


@database.put("/robots/{robot_id}/voice-config")
def update_voice_config(
    robot_id: int,
    req: ConfigReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    if current_user.Permission not in (1, 2):
        raise HTTPException(status_code=403, detail="음성 설정은 관리자만 변경할 수 있습니다")
    _get_robot_or_404(db, robot_id, current_user)

    fallback = (req.fallbackResponse or "").strip()
    if not fallback or len(fallback) > MAX_FALLBACK:
        raise HTTPException(status_code=422, detail=f"fallback 문구는 1~{MAX_FALLBACK}자여야 합니다")
    if not (0.1 <= req.matchThreshold <= 0.95):
        raise HTTPException(status_code=422, detail="매칭 임계값은 0.1~0.95 범위여야 합니다")
    if not (0.5 <= req.slotFuzzyThreshold <= 0.99):
        raise HTTPException(status_code=422, detail="목적지 퍼지 임계값은 0.5~0.99 범위여야 합니다")

    cfg = _get_or_create_config(db, robot_id)
    cfg.FallbackResponse = fallback
    cfg.MatchThreshold = req.matchThreshold
    cfg.SlotFuzzyThreshold = req.slotFuzzyThreshold
    cfg.ConfirmOnAction = 1 if req.confirmOnAction else 0
    db.commit()
    write_audit(db, current_user.id, "voice_config_updated", "voice", robot_id,
                detail=f"threshold={req.matchThreshold}", ip_address=get_client_ip(request))
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────
# 로봇 적용 번들 (export) — 로봇의 intents.yaml 과 동형
# ─────────────────────────────────────────────────────────
def _build_bundle(db: Session, robot: RobotInfo) -> dict:
    intents = (
        db.query(VoiceIntent)
        .options(selectinload(VoiceIntent.examples), selectinload(VoiceIntent.responses))
        .filter(VoiceIntent.RobotId == robot.id, VoiceIntent.IsActive == 1)
        .order_by(VoiceIntent.SortOrder, VoiceIntent.id)
        .all()
    )
    cfg = _get_or_create_config(db, robot.id)
    slots = (
        db.query(VoiceSlotValue)
        .filter(VoiceSlotValue.RobotId == robot.id, VoiceSlotValue.SlotName == SLOT_NAME)
        .all()
    )

    loc_ids = {s.LocationId for s in slots if s.LocationId}
    loc_map: dict[int, LocationInfo] = {}
    if loc_ids:
        for p in db.query(LocationInfo).filter(LocationInfo.id.in_(loc_ids)).all():
            loc_map[p.id] = p

    slot_values = []
    for s in slots:
        item = {
            "value": s.Value,
            "synonyms": _split_synonyms(s.Synonyms),
            "location_id": s.LocationId,
        }
        loc = loc_map.get(s.LocationId or 0)
        if loc:
            # 좌표는 '지금' 조인해서 싣는다 — DB에 복사해두지 않는다(맵이 바뀌면 어긋난다)
            item.update({
                "x": loc.LocationX, "y": loc.LocationY, "yaw": loc.Yaw,
                "map_id": loc.MapId, "floor_id": loc.FloorId,
            })
        slot_values.append(item)

    versions = [i.UpdatedAt for i in intents if i.UpdatedAt]
    version = max(versions).strftime("%Y-%m-%dT%H:%M:%SZ") if versions else "0"

    return {
        "version": version,
        "config": {
            "match_threshold": cfg.MatchThreshold,
            "confirm_on_action": bool(cfg.ConfirmOnAction),
            "slot_fuzzy_threshold": cfg.SlotFuzzyThreshold,
            "slot_fuzzy_min_len": cfg.SlotFuzzyMinLen,
            "silence_ms": cfg.SilenceMs,
            "tts_speed": cfg.TtsSpeed,
            "stt_model": cfg.SttModel,
        },
        "slots": {SLOT_NAME: {"values": slot_values}},
        "intents": [
            {
                "name": i.Name,
                "display_name": i.DisplayName,
                "examples": [e.Text for e in i.examples],
                "keyword_examples": [e.Text for e in i.examples if e.IsKeyword],
                "responses": [r.Text for r in i.responses],   # 2개 이상이면 로봇이 무작위로 고른다
                "action": i.ActionType,
            }
            for i in intents
        ],
        "fallback": {"response": cfg.FallbackResponse, "action": "none"},
    }


@database.get("/robots/{robot_id}/voice-export")
def export_voice_bundle(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    robot = _get_robot_or_404(db, robot_id, current_user)
    return _build_bundle(db, robot)


# ─────────────────────────────────────────────────────────
# 적용 대상 로봇 (음성 모듈 보유 + 온라인 여부)
# ─────────────────────────────────────────────────────────
@database.get("/robots/{robot_id}/voice-apply-targets")
def list_apply_targets(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """적용 후보 목록.

    '음성 모듈이 있는가'는 RobotModule(ModuleType='voice')로 판정한다 — 내장 카메라와 같은 구조.
    RobotType 으로 추정하지 않는다(같은 AMR 이라도 음성 하드웨어가 없을 수 있다).
    """
    _get_robot_or_404(db, robot_id, current_user)

    robots_q = db.query(RobotInfo).filter(RobotInfo.DeletedAt.is_(None))
    if not is_admin(current_user) and current_user.BusinessId:
        robots_q = robots_q.filter(
            RobotInfo.id.in_(get_business_robot_ids(db, current_user.BusinessId))
        )

    items = []
    for r in robots_q.order_by(RobotInfo.RobotName).all():
        mod = _voice_module(db, r.id)
        own_count = db.query(VoiceIntent).filter(VoiceIntent.RobotId == r.id).count()

        if not mod:
            reason, selectable = "음성 모듈 없음", False
        elif not mod.IsActive:
            reason, selectable = "음성 모듈 꺼짐", False
        elif not _agent_base_url(db, r):
            reason, selectable = "연결 정보 없음", False
        else:
            reason, selectable = None, True

        items.append({
            "robotId": r.id,
            "robotName": r.RobotName,
            "robotType": r.RobotType,
            "selectable": selectable,
            "reason": reason,
            "isSource": r.id == robot_id,
            "ownIntentCount": own_count,
        })
    return {"items": items}


# ─────────────────────────────────────────────────────────
# 로봇 적용 (NDJSON 스트리밍) · 미리듣기
# ─────────────────────────────────────────────────────────
class SyncReq(BaseModel):
    robotIds: list[int]


@database.post("/robots/{robot_id}/voice-sync")
def sync_voice_to_robots(
    robot_id: int,
    req: SyncReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """편집 원본 로봇의 번들을 대상 로봇들에 순차 적용한다.

    - 로봇 1대 = 독립 트랜잭션. 한 대가 실패해도 나머지는 계속한다(부분 실패 허용).
      CSV 일괄 등록(전량 거부)과 반대처럼 보이지만, 로봇 1대에 들어간 번들은 그 자체로 완결이다.
    - 병렬로 밀어넣지 않는다 — 각 로봇이 CPU로 TTS를 돌리므로 동시 실패 시 원인 분리가 어렵다.
    """
    source = _get_robot_or_404(db, robot_id, current_user)
    bundle = _build_bundle(db, source)

    # ORM 객체를 제너레이터로 넘기지 않는다 — 스트리밍 본문이 흐를 때쯤이면
    # 요청 세션(Depends(get_db))은 이미 닫혀 있다. 필요한 값만 미리 떠둔다.
    targets: list[dict] = []
    for rid in req.robotIds:
        r = _get_robot_or_404(db, rid, current_user)
        targets.append({"id": r.id, "name": r.RobotName})
    if not targets:
        raise HTTPException(status_code=422, detail="적용할 로봇을 선택하세요")

    user_id = current_user.id
    client_ip = get_client_ip(request)

    def event_stream():
        from app.database.database import SessionLocal

        for target in targets:
            tid, tname = target["id"], target["name"]
            yield json.dumps({
                "event": "start", "robotId": tid, "robotName": tname,
            }, ensure_ascii=False) + "\n"

            s = SessionLocal()
            lock_key = f"voice_sync_{tid}"
            locked = False
            try:
                # 같은 로봇에 두 사람이 동시에 적용하면 번들이 뒤섞여 들어간다.
                # 두 번째 요청은 기다리지 않고 즉시 알린다(0초 타임아웃).
                locked = s.execute(
                    sql_text("SELECT GET_LOCK(:k, 0)"), {"k": lock_key}
                ).scalar() == 1
                if not locked:
                    yield json.dumps({
                        "event": "failed", "robotId": tid,
                        "error": "다른 사용자가 이 로봇에 적용 중입니다",
                    }, ensure_ascii=False) + "\n"
                    continue

                robot = s.query(RobotInfo).filter(RobotInfo.id == tid).first()
                base = _agent_base_url(s, robot) if robot else None
                if not base:
                    yield json.dumps({
                        "event": "failed", "robotId": tid,
                        "error": "음성 모듈 연결 정보가 없습니다",
                    }, ensure_ascii=False) + "\n"
                    continue

                yield json.dumps({
                    "event": "step", "robotId": tid, "step": 1, "total": 3,
                    "msg": "설정 전송",
                }, ensure_ascii=False) + "\n"

                resp = requests.post(
                    f"{base}/sync", json=bundle, timeout=VOICE_AGENT_SYNC_TIMEOUT, stream=True,
                )
                resp.raise_for_status()

                synthesized = 0
                for raw in resp.iter_lines(decode_unicode=True):
                    if not raw:
                        continue
                    try:
                        evt = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    evt["robotId"] = tid
                    if evt.get("event") == "synth":
                        synthesized = evt.get("done", synthesized)
                    yield json.dumps(evt, ensure_ascii=False) + "\n"

                # 적용 성공 → 이 로봇의 시나리오를 '적용됨'으로 표시
                now = datetime.now()
                s.query(VoiceIntent).filter(VoiceIntent.RobotId == tid).update(
                    {VoiceIntent.AppliedAt: now}, synchronize_session=False
                )
                s.commit()
                write_audit(s, user_id, "voice_synced", "voice", tid,
                            detail=f"version={bundle['version']} synthesized={synthesized}",
                            ip_address=client_ip)

                yield json.dumps({
                    "event": "done", "robotId": tid,
                    "version": bundle["version"], "synthesized": synthesized,
                }, ensure_ascii=False) + "\n"

            except requests.exceptions.Timeout:
                yield json.dumps({
                    "event": "failed", "robotId": tid, "error": "연결 시간 초과",
                }, ensure_ascii=False) + "\n"
            except Exception as e:  # noqa: BLE001 — 어떤 실패든 다음 로봇은 계속 진행한다
                yield json.dumps({
                    "event": "failed", "robotId": tid, "error": str(e)[:120],
                }, ensure_ascii=False) + "\n"
            finally:
                if locked:
                    # 커넥션이 풀로 돌아가기 전에 반드시 푼다 — 안 풀면 그 로봇은 영영 잠긴다
                    try:
                        s.execute(sql_text("SELECT RELEASE_LOCK(:k)"), {"k": lock_key})
                    except Exception:  # noqa: BLE001
                        pass
                s.close()

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


class PreviewReq(BaseModel):
    text: str
    dest: str | None = None


@database.post("/robots/{robot_id}/voice-preview")
def preview_voice(
    robot_id: int,
    req: PreviewReq,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """미리듣기 — 로봇에 위임한다.

    조사 교정·숫자 한글화(10층 → '십층')는 로봇 쪽에 이미 있고 실기기 검증까지 끝났다.
    관제에 다시 구현하면 두 벌이 되어 반드시 어긋난다.
    부수 효과로 운영자가 듣는 소리 = 로봇이 실제로 낼 소리(같은 엔진·화자·속도)가 된다.
    """
    robot = _get_robot_or_404(db, robot_id, current_user)
    base = _agent_base_url(db, robot)
    if not base:
        raise HTTPException(status_code=409, detail="이 로봇에는 음성 모듈이 없습니다")

    try:
        resp = requests.post(
            f"{base}/tts/preview",
            json={"text": req.text, "dest": req.dest},
            timeout=VOICE_AGENT_TIMEOUT,
        )
        resp.raise_for_status()
    except requests.exceptions.RequestException:
        # 오프라인이면 글자 미리보기는 그대로 두고 재생만 막는다(편집·저장은 정상 동작)
        raise HTTPException(status_code=503, detail="로봇에 연결할 수 없어 소리를 들을 수 없습니다")

    return Response(content=resp.content, media_type=resp.headers.get("Content-Type", "audio/wav"))


# ─────────────────────────────────────────────────────────
# 말로 지시 — STT + 의도매칭 (사람 말 → 로봇 동작)
#
# 관제가 오디오(또는 텍스트)를 로봇 에이전트로 넘겨 '무슨 뜻인지' 판정받고,
# 판정된 동작(sit/stand/회전/정지)을 관제의 기존 /robot/* 로 실제 실행한다.
# navigate 는 placemove, 그 외 동작은 mode.py 명령으로 잇는다.
# ─────────────────────────────────────────────────────────
_MOTION_TO_SENDER = {
    "stand": "STAND", "sit": "SIT",
    "left_turn": "LEFTTURN", "right_turn": "RIGHTTURN", "stop": "STOP",
}


def _execute_intent(db: Session, robot: RobotInfo, user: UserInfo, verdict: dict) -> dict | None:
    """판정 결과(verdict)를 실제 로봇 동작으로 실행한다. 실행한 게 없으면 None."""
    action = verdict.get("action")
    if not action or action == "none":
        return None

    # 동작 명령(sit/stand/회전/정지) → 로봇에 직접 송신
    if action in _MOTION_TO_SENDER:
        from app.robot_io.sender import send_to_robot
        send_to_robot(_MOTION_TO_SENDER[action])
        return {"kind": "motion", "action": action}

    # 안내 → 슬롯의 목적지를 장소 좌표로 이동
    if action == "navigate":
        dest = (verdict.get("slots") or {}).get(SLOT_NAME)
        if not dest:
            return {"kind": "navigate", "action": action, "moved": False, "msg": "목적지를 못 알아들었습니다"}
        slot = (
            db.query(VoiceSlotValue)
            .filter(VoiceSlotValue.RobotId == robot.id,
                    VoiceSlotValue.SlotName == SLOT_NAME,
                    VoiceSlotValue.Value == dest)
            .first()
        )
        if slot and slot.LocationId:
            from app.navigation.send_move import move_to_place
            try:
                result = move_to_place(slot.LocationId, db, user)
                return {"kind": "navigate", "action": action, "dest": dest,
                        "moved": result.get("status") == "ok", "msg": result.get("msg")}
            except HTTPException as e:
                return {"kind": "navigate", "action": action, "dest": dest, "moved": False, "msg": e.detail}
        return {"kind": "navigate", "action": action, "dest": dest, "moved": False,
                "msg": "연결된 장소가 없어 말만 했습니다"}

    if action == "stop":
        from app.robot_io.sender import send_to_robot
        send_to_robot("STOP")
        return {"kind": "stop", "action": action}
    return None


class UnderstandReq(BaseModel):
    text: str
    execute: bool = False    # 판정만 할지, 실제 로봇 동작까지 할지


@database.post("/robots/{robot_id}/voice-understand")
def voice_understand(
    robot_id: int,
    req: UnderstandReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """텍스트 → 의도 판정(+선택적 실행). STT 없이 '이 말을 로봇이 어떻게 알아듣나' 테스트."""
    robot = _get_robot_or_404(db, robot_id, current_user)
    base = _agent_base_url(db, robot)
    if not base:
        raise HTTPException(status_code=409, detail="이 로봇에는 음성 모듈이 없습니다")

    try:
        r = requests.post(f"{base}/understand", json={"text": req.text},
                          timeout=VOICE_AGENT_TIMEOUT + 20)
        r.raise_for_status()
        verdict = r.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"로봇이 응답하지 않습니다: {str(e)[:80]}")

    executed = _execute_intent(db, robot, current_user, verdict) if req.execute else None
    if req.execute:
        write_audit(db, current_user.id, "voice_understand", "voice", robot_id,
                    detail=f"heard={verdict.get('heard')} action={verdict.get('action')}",
                    ip_address=get_client_ip(request))
    return {"verdict": verdict, "executed": executed}


@database.post("/robots/{robot_id}/voice-listen")
async def voice_listen(
    robot_id: int,
    request: Request,
    file: UploadFile = File(...),
    execute: bool = False,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """오디오(wav) → STT → 의도 판정(+선택적 실행). '말하면 알아듣는' 전체 경로."""
    robot = _get_robot_or_404(db, robot_id, current_user)
    base = _agent_base_url(db, robot)
    if not base:
        raise HTTPException(status_code=409, detail="이 로봇에는 음성 모듈이 없습니다")

    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="오디오가 너무 큽니다 (최대 5MB)")

    try:
        r = requests.post(f"{base}/listen",
                          files={"file": (file.filename or "audio.wav", raw, "audio/wav")},
                          timeout=60)
        r.raise_for_status()
        verdict = r.json()
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"로봇이 응답하지 않습니다: {str(e)[:80]}")

    executed = _execute_intent(db, robot, current_user, verdict) if execute else None
    write_audit(db, current_user.id, "voice_listen", "voice", robot_id,
                detail=f"heard={verdict.get('heard')} action={verdict.get('action')} exec={execute}",
                ip_address=get_client_ip(request))
    return {"verdict": verdict, "executed": executed}


# ─────────────────────────────────────────────────────────
# 리허설 — "말하고 그대로 움직인다" (STT·의도매칭 없이 검증)
#
# 로봇에는 '말하는 것'만 시킨다(POST /tts/say). 이동은 관제가 이미 가진
# placemove 를 직접 호출한다 — 로봇에 이동 로직을 새로 만들 필요가 없다.
# ⚠ 이 엔드포인트는 로봇 하드웨어를 실제로 울리고 움직인다.
# ─────────────────────────────────────────────────────────
class RehearseReq(BaseModel):
    text: str                       # 로봇이 말할 문장 (예: "{목적지}로 안내하겠습니다")
    dest: str | None = None         # 목적지 값 (예: "응급실"). 슬롯 치환·이동에 쓴다
    move: bool = True               # 목적지가 연결돼 있으면 실제로 이동시킬지


@database.post("/robots/{robot_id}/voice-rehearse")
def rehearse(
    robot_id: int,
    req: RehearseReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    robot = _get_robot_or_404(db, robot_id, current_user)
    base = _agent_base_url(db, robot)
    if not base:
        raise HTTPException(status_code=409, detail="이 로봇에는 음성 모듈이 없습니다")

    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="말할 문장이 없습니다")

    steps: list[dict] = []

    # ── ① 로봇 스피커로 말한다 ──
    try:
        r = requests.post(
            f"{base}/tts/say",
            json={"text": text, "dest": req.dest},
            timeout=VOICE_AGENT_TIMEOUT + 20,   # say 는 재생 시간만큼 더 걸린다
        )
        r.raise_for_status()
        steps.append({"step": "say", "ok": True, "spoken": r.json().get("spoken")})
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=503, detail=f"로봇이 말하지 못했습니다: {str(e)[:80]}")

    # ── ② 목적지가 '실제 장소'와 연결돼 있으면 이동 ──
    moved = None
    if req.move and req.dest:
        slot = (
            db.query(VoiceSlotValue)
            .filter(
                VoiceSlotValue.RobotId == robot_id,
                VoiceSlotValue.SlotName == SLOT_NAME,
                VoiceSlotValue.Value == req.dest,
            )
            .first()
        )
        if slot and slot.LocationId:
            # 관제가 이미 가진 이동 API 를 그대로 호출한다. 온라인·위치초기화 가드는
            # move_to_place 내부에 있으므로 여기서 중복 검사하지 않는다.
            from app.navigation.send_move import move_to_place
            try:
                result = move_to_place(slot.LocationId, db, current_user)
                moved = {"locationId": slot.LocationId, "result": result}
                steps.append({"step": "move", "ok": result.get("status") == "ok",
                              "msg": result.get("msg")})
            except HTTPException as e:
                steps.append({"step": "move", "ok": False, "msg": e.detail})
            except Exception as e:  # noqa: BLE001
                steps.append({"step": "move", "ok": False, "msg": str(e)[:80]})
        else:
            # 목적지에 좌표가 없으면 말만 한다 — 의도된 동작(안내 멘트 전용)
            steps.append({"step": "move", "ok": False, "msg": "연결된 장소가 없어 말만 했습니다"})

    write_audit(db, current_user.id, "voice_rehearse", "voice", robot_id,
                detail=f"text={text[:40]} dest={req.dest} moved={bool(moved)}",
                ip_address=get_client_ip(request))
    return {"status": "ok", "steps": steps, "moved": moved}


# ─────────────────────────────────────────────────────────
# 대화 로그 적재 (로봇 → 관제). 화면은 Phase 5.
# ─────────────────────────────────────────────────────────
class DialogLogReq(BaseModel):
    heard: str
    intentId: int | None = None
    score: float | None = None
    slotValue: str | None = None
    acted: bool = False


@database.post("/robots/{robot_id}/voice-dialog-logs")
def ingest_dialog_log(
    robot_id: int,
    req: DialogLogReq,
    request: Request,
    db: Session = Depends(get_db),
):
    """로봇이 대화 1건마다 fire-and-forget 으로 보낸다. 실패해도 로봇의 대화는 계속된다.

    ⚠ 이 엔드포인트는 사용자 로그인을 요구하지 않는다(로봇은 계정이 없다).
    대신 '그 로봇의 주소에서 온 요청'만 받는다 — 열어두면 누구나 DB를 채울 수 있고,
    여기 쌓이는 건 병원에서 환자가 말한 내용이다.
    """
    robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="로봇을 찾을 수 없습니다")

    client_ip = get_client_ip(request)
    allowed = {robot.RobotIP}
    mod = _voice_module(db, robot_id)
    if mod:
        info = db.query(ModuleVoiceInfo).filter(ModuleVoiceInfo.ModuleId == mod.id).first()
        if info and info.Host:
            allowed.add(info.Host)
    allowed.discard(None)
    if client_ip not in allowed:
        raise HTTPException(status_code=403, detail="이 로봇의 주소에서 온 요청이 아닙니다")

    db.add(VoiceDialogLog(
        RobotId=robot_id,
        Heard=(req.heard or "")[:200],
        IntentId=req.intentId,
        Score=req.score,
        SlotValue=(req.slotValue or None),
        Acted=1 if req.acted else 0,
    ))
    db.commit()
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────
# CSV — 내보내기 포맷 = 가져오기 포맷 (왕복 편집)
# ─────────────────────────────────────────────────────────
CSV_HEADER = ["시나리오명", "동작", "질문", "답변", "활성"]


@database.get("/robots/{robot_id}/voice-intents/export.csv")
def export_voice_csv(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    robot = _get_robot_or_404(db, robot_id, current_user)
    intents = (
        db.query(VoiceIntent)
        .options(selectinload(VoiceIntent.examples), selectinload(VoiceIntent.responses))
        .filter(VoiceIntent.RobotId == robot_id)
        .order_by(VoiceIntent.SortOrder, VoiceIntent.id)
        .all()
    )

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_HEADER)
    for i in intents:
        w.writerow([
            i.DisplayName,
            ACTION_LABELS.get(i.ActionType, "없음"),   # 엔진 값(navigate)이 아니라 한글 — 운영자가 여는 파일이다
            "|".join(e.Text for e in i.examples),
            "|".join(r.Text for r in i.responses),
            1 if i.IsActive else 0,
        ])

    # UTF-8 BOM — 없으면 엑셀에서 한글이 깨진다
    body = "﻿" + buf.getvalue()
    filename = f"voice_{robot.RobotName}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@database.post("/robots/{robot_id}/voice-intents/import")
async def import_voice_csv(
    robot_id: int,
    request: Request,
    file: UploadFile = File(...),
    dryRun: bool = True,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """CSV 일괄 등록.

    - 전량 거부(all-or-nothing): 1행이라도 검증에 걸리면 아무것도 등록하지 않는다.
      "9건은 들어가고 3건은 안 들어간" 상태로 로봇에 적용하면 반쪽짜리 지식으로 말한다.
    - 병합(upsert): 시나리오명이 키. 신규 추가 / 동명 갱신 /
      파일에 없는 기존 시나리오는 건드리지 않는다(일부만 담긴 파일로 전체가 지워지면 안 된다).
    """
    _get_robot_or_404(db, robot_id, current_user)

    raw = await file.read()
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"파일이 너무 큽니다 (최대 {MAX_IMPORT_BYTES // 1024}KB)",
        )
    # 한국어 윈도우 엑셀은 '다른 이름으로 저장 > CSV' 시 CP949 로 쓴다.
    # UTF-8 만 받으면 "내려받아 엑셀로 고쳐서 올렸는데 한글이 깨진다"가 된다.
    text = None
    for enc in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise HTTPException(
            status_code=422,
            detail="파일 인코딩을 읽을 수 없습니다. 엑셀에서 'CSV UTF-8' 로 저장하거나 xlsx 파일을 올려주세요.",
        )

    reader = list(csv.reader(io.StringIO(text)))
    if not reader:
        raise HTTPException(status_code=422, detail="빈 파일입니다")

    header, *rows = reader
    if [h.strip() for h in header[:5]] != CSV_HEADER:
        raise HTTPException(
            status_code=422,
            detail=f"첫 줄은 {','.join(CSV_HEADER)} 여야 합니다. [양식 다운로드]를 사용하세요.",
        )
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(status_code=422, detail=f"최대 {MAX_IMPORT_ROWS}행까지 등록할 수 있습니다")

    existing = {
        i.DisplayName: i
        for i in db.query(VoiceIntent).filter(VoiceIntent.RobotId == robot_id).all()
    }

    errors: list[dict] = []
    parsed: list[dict] = []
    seen_names: set[str] = set()

    for idx, row in enumerate(rows):
        line = idx + 2   # 엑셀 줄 번호(헤더 1줄 + 1-base) — 사용자는 그 줄을 찾아야 한다
        if not row or not any(c.strip() for c in row):
            continue
        row = (row + [""] * 5)[:5]
        name, action_label, q_raw, a_raw, active_raw = [c.strip() for c in row]

        def err(reason: str):
            errors.append({"line": line, "name": name, "reason": reason})

        if not name:
            err("시나리오명이 비어 있습니다")
            continue
        if len(name) > MAX_DISPLAY_NAME:
            err(f"시나리오명이 {MAX_DISPLAY_NAME}자를 넘습니다")
            continue
        if name in seen_names:
            err("파일 안에서 시나리오명이 중복됩니다")
            continue
        seen_names.add(name)

        action = LABEL_TO_ACTION.get(action_label)
        if action is None:
            err(f"동작은 {' / '.join(ACTION_LABELS.values())} 중 하나여야 합니다")
            continue

        examples = [e.strip() for e in q_raw.split("|") if e.strip()]
        responses = [r.strip() for r in a_raw.split("|") if r.strip()]

        if not (MIN_EXAMPLES <= len(examples) <= MAX_EXAMPLES):
            err(f"질문이 {len(examples)}개입니다 — {MIN_EXAMPLES}~{MAX_EXAMPLES}개여야 합니다")
            continue
        if not (MIN_RESPONSES <= len(responses) <= MAX_RESPONSES):
            err(f"답변이 {len(responses)}개입니다 — {MIN_RESPONSES}~{MAX_RESPONSES}개여야 합니다")
            continue
        if any(len(e) > MAX_EXAMPLE_TEXT for e in examples):
            err(f"질문이 {MAX_EXAMPLE_TEXT}자를 넘습니다")
            continue
        if any(len(r) > MAX_RESPONSE_TEXT for r in responses):
            err(f"답변이 {MAX_RESPONSE_TEXT}자를 넘습니다")
            continue

        bad_token = next(
            (m.group(0) for t in examples + responses for m in TOKEN_RE.finditer(t)
             if m.group(1) != SLOT_NAME),
            None,
        )
        if bad_token:
            err(f"'{bad_token}' 는 사용할 수 없습니다 (목적지는 '{SLOT_TOKEN}' 하나뿐입니다)")
            continue

        if action == "navigate" and not any(SLOT_TOKEN in e for e in examples):
            err(f"동작이 '안내'인데 질문에 {SLOT_TOKEN} 가 없습니다")
            continue

        # 오타로 새 시나리오를 만드는 사고 방지 (기존 이름과 지나치게 닮은 경우)
        if name not in existing:
            near = next(
                (
                    ex_name for ex_name in existing
                    if _similarity(name, ex_name) >= SIMILARITY_BLOCK
                ),
                None,
            )
            if near:
                err(f"기존 '{near}' 와 지나치게 유사합니다 (오타로 보입니다)")
                continue

        parsed.append({
            "line": line, "name": name, "action": action,
            "examples": examples, "responses": responses,
            "isActive": 0 if active_raw in ("0", "false", "False") else 1,
            "mode": "update" if name in existing else "create",
        })

    summary = {
        "totalRows": len(parsed) + len(errors),
        "created": sum(1 for p in parsed if p["mode"] == "create"),
        "updated": sum(1 for p in parsed if p["mode"] == "update"),
        "untouched": len([n for n in existing if n not in seen_names]),
        "untouchedNames": [n for n in existing if n not in seen_names][:10],
    }

    # 전량 거부 — 하나라도 걸리면 아무것도 쓰지 않는다
    if errors:
        return {"status": "invalid", "errors": errors, "summary": summary}
    if dryRun:
        return {"status": "ok", "errors": [], "summary": summary}

    # 단일 트랜잭션. 전부 커밋되거나 전부 롤백된다.
    try:
        for p in parsed:
            intent = existing.get(p["name"])
            if intent:
                intent.ActionType = p["action"]
                intent.IsActive = p["isActive"]
                _mark_dirty(intent, current_user)
                db.query(VoiceIntentExample).filter(
                    VoiceIntentExample.IntentId == intent.id
                ).delete()
                db.query(VoiceIntentResponse).filter(
                    VoiceIntentResponse.IntentId == intent.id
                ).delete()
            else:
                intent = VoiceIntent(
                    RobotId=robot_id,
                    Name=_next_intent_name(db, robot_id),
                    DisplayName=p["name"],
                    ActionType=p["action"],
                    IsActive=p["isActive"],
                    UpdatedBy=current_user.id,
                )
                db.add(intent)
                db.flush()

            for i, t in enumerate(p["examples"]):
                db.add(VoiceIntentExample(IntentId=intent.id, Text=t, SortOrder=i))
            for i, t in enumerate(p["responses"]):
                db.add(VoiceIntentResponse(IntentId=intent.id, Text=t, SortOrder=i))

        db.commit()
    except Exception as e:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status_code=500, detail=f"등록에 실패해 전체를 취소했습니다: {e}")

    # 실제로 바뀐 게 있을 때만 감사 로그를 남긴다 (빈 파일 커밋의 0건 노이즈 방지)
    if summary["created"] + summary["updated"] > 0:
        write_audit(db, current_user.id, "voice_imported", "voice", robot_id,
                    detail=f"created={summary['created']} updated={summary['updated']}",
                    ip_address=get_client_ip(request))
    return {"status": "ok", "errors": [], "summary": summary}


# ─────────────────────────────────────────────────────────
# 도착 확인 인식어 (voice_confirm_word)
#
# 경유지 도착 확인(확인 방식='음성')에서 통과로 볼 말. 코드에 박아 두면 운영자가
# 볼 수도 고칠 수도 없고, 안내 멘트가 유도하는 말과 어긋나도 알 방법이 없다.
# 판정은 서버 단일 출처 — 화면은 이 목록을 조회해서 보여주기만 한다.
# ─────────────────────────────────────────────────────────

class ConfirmWordReq(BaseModel):
    word: str
    isActive: bool = True
    sortOrder: int = 0


VALID_KINDS = ("arrival", "dismiss")


def _check_kind(kind: str) -> str:
    """종류를 검사한다. 오타로 엉뚱한 종류가 생기면 판정에서 조용히 빠진다."""
    k = (kind or "arrival").strip().lower()
    if k not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"알 수 없는 인식어 종류: {kind}")
    return k


def _defaults_for(kind: str) -> tuple[str, ...]:
    from app.database.routes.agent_bridge import DEFAULT_ARRIVAL_AFFIRM, DEFAULT_DISMISS_WORDS
    return DEFAULT_DISMISS_WORDS if kind == "dismiss" else DEFAULT_ARRIVAL_AFFIRM


def _confirm_row(w: VoiceConfirmWord) -> dict:
    return {"id": w.id, "word": w.Word, "kind": w.Kind,
            "isActive": bool(w.IsActive), "sortOrder": w.SortOrder}


@database.get("/robots/{robot_id}/voice-confirm-words")
def list_confirm_words(
    robot_id: int,
    kind: str = "arrival",
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """등록된 인식어 + 기본 목록. 비어 있으면 기본이 쓰인다는 걸 화면이 알아야 한다."""
    _get_robot_or_404(db, robot_id, current_user)
    kind = _check_kind(kind)
    defaults = _defaults_for(kind)

    rows = (
        db.query(VoiceConfirmWord)
        .filter(VoiceConfirmWord.RobotId == robot_id, VoiceConfirmWord.Kind == kind)
        .order_by(VoiceConfirmWord.SortOrder, VoiceConfirmWord.id)
        .all()
    )
    return {
        "items": [_confirm_row(w) for w in rows],
        "defaults": list(defaults),
        "kind": kind,
        # 등록이 없으면 기본 목록으로 동작한다 — 화면이 그 사실을 알려야 오해가 없다
        "usingDefaults": not any(w.IsActive for w in rows),
    }


@database.post("/robots/{robot_id}/voice-confirm-words")
def create_confirm_word(
    robot_id: int,
    req: ConfirmWordReq,
    request: Request,
    kind: str = "arrival",
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    _get_robot_or_404(db, robot_id, current_user)
    kind = _check_kind(kind)
    defaults = _defaults_for(kind)

    word = (req.word or "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="인식어를 입력하세요.")
    if len(word) > 30:
        raise HTTPException(status_code=400, detail="인식어는 30자를 넘을 수 없습니다.")

    # 등록이 하나라도 있으면 그 목록이 전부다(기본은 더 이상 쓰이지 않는다).
    # 그래서 **첫 등록 때 기본을 먼저 깔아 준다** — 안 그러면 하나 추가하는 순간
    # "네"·"출발" 같은 기본 인식어가 통째로 빠져 현장에서 확인이 안 된다.
    existing = (
        db.query(VoiceConfirmWord)
        .filter(VoiceConfirmWord.RobotId == robot_id, VoiceConfirmWord.Kind == kind)
        .count()
    )
    seeded = 0
    if existing == 0:
        for i, w in enumerate(defaults):
            db.add(VoiceConfirmWord(RobotId=robot_id, Kind=kind, Word=w, IsActive=1, SortOrder=i))
        db.flush()
        seeded = len(defaults)

    dup = (
        db.query(VoiceConfirmWord)
        .filter(VoiceConfirmWord.RobotId == robot_id,
                VoiceConfirmWord.Kind == kind, VoiceConfirmWord.Word == word)
        .first()
    )
    if dup:
        db.commit()   # 시딩은 살린다 — 중복이라고 기본 목록까지 되돌릴 이유가 없다
        raise HTTPException(
            status_code=409,
            detail=(f"'{word}' 는 기본 인식어에 이미 있습니다." if seeded
                    else f"'{word}' 는 이미 등록되어 있습니다."),
        )

    row = VoiceConfirmWord(RobotId=robot_id, Kind=kind, Word=word,
                           IsActive=1 if req.isActive else 0,
                           SortOrder=req.sortOrder or seeded)
    db.add(row)
    db.commit()
    db.refresh(row)
    write_audit(db, current_user.id, "voice_confirm_word_created", "voice", robot_id,
                detail=f"인식어({kind}): {word}" + (f" (기본 {seeded}개 함께 등록)" if seeded else ""),
                ip_address=get_client_ip(request))
    # seeded 를 돌려줘야 화면이 "기본도 함께 등록했습니다"를 알릴 수 있다
    return {"status": "ok", "seeded": seeded, **_confirm_row(row)}


@database.put("/voice-confirm-words/{word_id}")
def update_confirm_word(
    word_id: int,
    req: ConfirmWordReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    row = db.query(VoiceConfirmWord).filter(VoiceConfirmWord.id == word_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="인식어를 찾을 수 없습니다.")
    _get_robot_or_404(db, row.RobotId, current_user)

    word = (req.word or "").strip()
    if not word:
        raise HTTPException(status_code=400, detail="인식어를 입력하세요.")
    # 종류는 바꾸지 않는다 — 도착 확인용을 해산용으로 옮기는 조작은 만들지 않았다
    dup = (
        db.query(VoiceConfirmWord)
        .filter(VoiceConfirmWord.RobotId == row.RobotId, VoiceConfirmWord.Kind == row.Kind,
                VoiceConfirmWord.Word == word, VoiceConfirmWord.id != word_id)
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail=f"'{word}' 는 이미 등록되어 있습니다.")

    before = row.Word
    row.Word = word
    row.IsActive = 1 if req.isActive else 0
    row.SortOrder = req.sortOrder
    db.commit()
    write_audit(db, current_user.id, "voice_confirm_word_updated", "voice", row.RobotId,
                detail=f"인식어({row.Kind}): {before} → {word}", ip_address=get_client_ip(request))
    return {"status": "ok", **_confirm_row(row)}


@database.delete("/voice-confirm-words/{word_id}")
def delete_confirm_word(
    word_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    row = db.query(VoiceConfirmWord).filter(VoiceConfirmWord.id == word_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="인식어를 찾을 수 없습니다.")
    _get_robot_or_404(db, row.RobotId, current_user)
    robot_id, word, kind = row.RobotId, row.Word, row.Kind
    db.delete(row)
    db.commit()
    write_audit(db, current_user.id, "voice_confirm_word_deleted", "voice", robot_id,
                detail=f"인식어({kind}): {word}", ip_address=get_client_ip(request))
    return {"status": "ok"}


@database.post("/robots/{robot_id}/voice-confirm-words/reset")
def reset_confirm_words(
    robot_id: int,
    request: Request,
    kind: str = "arrival",
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("voice")),
):
    """기본 목록으로 되돌린다 — 지우다가 다 지워도 되살릴 길이 있어야 한다."""
    _get_robot_or_404(db, robot_id, current_user)
    kind = _check_kind(kind)
    defaults = _defaults_for(kind)

    (db.query(VoiceConfirmWord)
       .filter(VoiceConfirmWord.RobotId == robot_id, VoiceConfirmWord.Kind == kind)
       .delete())
    for i, w in enumerate(defaults):
        db.add(VoiceConfirmWord(RobotId=robot_id, Kind=kind, Word=w, IsActive=1, SortOrder=i))
    db.commit()
    write_audit(db, current_user.id, "voice_confirm_words_reset", "voice", robot_id,
                detail=f"기본 {len(defaults)}개로 초기화({kind})",
                ip_address=get_client_ip(request))
    return {"status": "ok", "count": len(defaults)}
