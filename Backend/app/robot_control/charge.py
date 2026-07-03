"""충전 관련 엔드포인트: 충전소 이동 / 작업 정지 후 도킹 포인트 이동"""

import socket
import time

from fastapi import APIRouter

from app.database.database import SessionLocal
from app.database.models import LocationInfo
from app.user_cache import get_robot_id, get_robot_name, get_robot_business_id
from app.logs.service import log_event

router = APIRouter()

# 충전 복귀 시 "이미 도킹 포인트에 있음"으로 판정하는 거리 임계값(m).
# 현재 위치가 도킹 포인트(ch-1)로부터 이 거리 안쪽이면 접근 경유지(ch-2, ch-3...)를
# 건너뛰고 도킹 포인트로 직행한다. 경유지는 벽/꺾인 길목 회피용이라, 실제로 도킹
# 영역에 있을 때만 생략해야 안전하므로 보수적으로 잡는다. (운영 조정: 1.2 → 2.0)
AT_DOCK_THRESHOLD_M = 2.0


@router.post("/robot/charge")
def start_charge():
    """충전소로 이동 (자동 충전) 명령 전송."""
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {
                "Charge": 1
            }
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        # 진단용 마커: 이 시점부터 charge_state 시계열을 추적해야 함
        print(
            "🔋 [CHARGE START] 충전소 이동 명령(UDP Charge=1) 송신 — "
            "이후 [CHARGE] state 전환 로그로 도킹 결과 추적"
        )
        log_event("robot", "robot_charging_start", "충전소 이동 명령 전송",
                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        return {"status": "ok", "msg": "충전소 이동 명령 전송 완료"}
    except Exception as e:
        return {"status": "error", "msg": str(e)}
    finally:
        sock.close()


@router.post("/robot/stop-charge")
def stop_charge():
    """충전 해제 (Charge=0). 도킹 상태에서 충전을 해제한다."""
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {
                "Charge": 0
            }
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        log_event("robot", "robot_charging_stop", "충전 해제 명령 전송",
                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())
        return {"status": "ok", "msg": "충전 해제 명령 전송 완료"}
    except Exception as e:
        return {"status": "error", "msg": str(e)}
    finally:
        sock.close()


def _send_stop_charge_packet() -> bool:
    """stop-charge UDP 패킷만 전송 (상태 체크 없이). 내부 헬퍼."""
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {"Charge": 0},
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        return True
    except Exception as e:
        print(f"[WARN] stop-charge 전송 실패: {e}")
        return False
    finally:
        sock.close()


def _get_robot_floor_id(db) -> int | None:
    """현재 로봇(get_robot_id)의 활성 층 ID. 미설정이면 None."""
    from app.database.models import RobotInfo

    rid = get_robot_id()
    if not rid:
        return None
    robot = db.query(RobotInfo).filter(RobotInfo.id == rid).first()
    return robot.CurrentFloorId if robot else None


def _find_charge_station(db, floor_id: int | None):
    """충전소(Category=charge)를 로봇 현재 층 기준으로 선택.

    - 층을 알면 그 층의 충전소만 반환한다(다른 층 좌표로 보내면 물리적으로 엉뚱한
      위치이므로, 현재 층에 없으면 None 을 반환해 caller 가 중단하게 한다).
    - 층 미상(None)이면 첫 충전소로 폴백한다(단일 층/층 미설정 환경 하위호환).
    """
    q = db.query(LocationInfo).filter(LocationInfo.Category == "charge")
    if floor_id is not None:
        return q.filter(LocationInfo.FloorId == floor_id).first()
    return q.first()


def build_overheat_return_route() -> list[dict] | None:
    """모터 과열 보호용 — 현재 층 충전소의 접근통로(ch-N 내림차순→도킹 ch-1) 웨이포인트 리스트.

    충전 복귀와 동일한 루트를 쓰되, nav 상태는 건드리지 않고 웨이포인트만 반환한다
    (전환은 navigation_send_next / trigger_overheat_protection 가 수행). 현재 층에
    충전소나 도킹 포인트(ch-1)가 없으면 None.
    """
    db = SessionLocal()
    try:
        floor_id = _get_robot_floor_id(db)
        charge_station = _find_charge_station(db, floor_id)
        if not charge_station:
            return None
        prefix = f"{charge_station.LacationName}-"
        q = db.query(LocationInfo).filter(LocationInfo.LacationName.like(f"{prefix}%"))
        if floor_id is not None:
            q = q.filter(LocationInfo.FloorId == floor_id)
        numbered: list[tuple[int, LocationInfo]] = []
        for row in q.all():
            suffix = row.LacationName[len(prefix):]
            if suffix.isdigit():
                numbered.append((int(suffix), row))
        if not any(n == 1 for n, _ in numbered):
            return None  # 도킹 포인트(ch-1) 없음
        numbered.sort(key=lambda t: t[0], reverse=True)
        return [
            {"x": row.LocationX, "y": row.LocationY, "yaw": row.Yaw or 0.0, "name": row.LacationName}
            for _, row in numbered
        ]
    finally:
        db.close()


def trigger_overheat_protection() -> None:
    """모터 과열 위험 시 보호 동작 실행.

    - 작업 중: 현재 포인트까지 수행 후 충전소 도킹 루트로 전환 → 도킹 포인트에서 SIT
      (overheat_return_pending 예약 → navigation_send_next 가 다음 도착 시 전환).
    - 유휴: 즉시 도킹 루트 주행 시작 → 도착 후 SIT.
    - 도킹 루트 없음(현재 층 충전소/ch-1 미등록): 제자리 SIT 로 모터 부하 제거(안전 폴백).
    - 이미 보호 진행 중이면 무시(중복 트리거 가드).
    """
    import app.navigation.send_move as nav
    from app.navigation.send_move import _signal_nav_reset, navigation_send_next
    from app.robot_io.sender import send_to_robot
    from app.scheduler.loop import cancel_active_schedule, get_active_schedule_id

    if getattr(nav, "overheat_return_pending", False) or getattr(nav, "sit_on_arrival", False):
        print("🌡️ 모터 과열 보호 이미 진행 중 — 중복 트리거 무시")
        return

    # 스케줄 작업 중이었다면 '취소' 처리 (과열로 중단했으므로 '완료'로 오기록 방지).
    # cancel_active_schedule 은 _active_schedule_id 만 비우고 nav 상태는 두므로, 아래
    # is_navigating 분기는 그대로 동작한다(현재 포인트 완료 후 도킹 루트 전환).
    if get_active_schedule_id() is not None:
        cancel_active_schedule("모터 과열 보호")

    route = build_overheat_return_route()

    if nav.is_navigating:
        if route:
            # 현재 WP 도착 시 충전소 루트로 전환(현재 포인트까지는 수행됨)
            nav.overheat_return_pending = True
            print("🌡️ 모터 과열 보호: 현재 포인트 완료 후 충전소 도킹 루트로 전환 예약")
        else:
            # 도킹 루트 없음 → 작업 정지 후 제자리 SIT
            nav.is_navigating = False
            nav.current_wp_index = 0
            nav.charge_on_arrival = False
            nav.auto_return_to_charge = False
            _signal_nav_reset(full=True)
            try:
                send_to_robot("STOP")
                time.sleep(0.5)
                send_to_robot("SIT")
            except Exception as e:
                print(f"[ERR] 과열 보호 SIT 전송 실패: {e}")
            print("🌡️ 모터 과열 보호: 도킹 루트 없음 — 작업 정지 후 제자리 SIT")
        return

    # 유휴 상태
    if route:
        nav.waypoints_list = route
        nav.current_wp_index = 0
        nav.is_navigating = True
        nav.nav_loop_remaining = 0
        nav.nav_loop_total = 0
        nav.nav_loop_infinite = False
        nav.charge_on_arrival = False
        nav.sit_on_arrival = True
        nav.auto_return_to_charge = False
        _signal_nav_reset(full=True)
        print("🌡️ 모터 과열 보호(유휴): 충전소 도킹 루트 주행 시작 — 도착 후 SIT")
        navigation_send_next()
    else:
        try:
            send_to_robot("SIT")
        except Exception as e:
            print(f"[ERR] 과열 보호 SIT 전송 실패: {e}")
        print("🌡️ 모터 과열 보호(유휴): 도킹 루트 없음 — 제자리 SIT")


def _send_start_charge_packet() -> bool:
    """start-charge UDP 패킷만 전송 (Charge=1, 로그 없이). 내부 헬퍼.

    완충 대기(state 0)에서 도크 이탈 시퀀스(state 2→3→0)를 트리거하기 위해
    충전을 잠깐 재개(state→2)시키는 용도. 이후 stop-charge(Charge=0)로 이탈.
    """
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {"Charge": 1},
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        return True
    except Exception as e:
        print(f"[WARN] start-charge(Charge=1) 전송 실패: {e}")
        return False
    finally:
        sock.close()


def _send_charge_clear_packet() -> bool:
    """Charge=2(충전 상태 지우기) UDP 패킷 전송. 내부 헬퍼.

    언도킹(도킹 이탈) 확정 시점에 로봇 충전 상태머신을 강제 리셋하여,
    ROS2 `/CHARGE_STATUS` 전환 통보 누락에 의한 stale(충전 중) 고정을 방지한다.
    """
    from app.robot_io import ROBOT_IP, ROBOT_PORT, build_packet

    asdu = {
        "PatrolDevice": {
            "Type": 2,
            "Command": 24,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": {"Charge": 2},
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(build_packet(asdu), (ROBOT_IP, ROBOT_PORT))
        return True
    except Exception as e:
        print(f"[WARN] charge-clear(Charge=2) 전송 실패: {e}")
        return False
    finally:
        sock.close()


def start_charge_with_retry(
    max_retries: int = 2,
    verify_timeout: float = 15.0,
    poll_interval: float = 1.0,
) -> None:
    """도킹 포인트 도착 후 자동 충전 + 실패 시 재시도. **별도 스레드에서 실행**(내부 sleep 루프).

    Charge=1(충전소 이동) 송신 후 charge_state 가 2(충전 중)/5(완충 도크)에 도달하는지
    `verify_timeout` 초 확인한다. 도달 못 하면(도킹 실패: state 1→0, 또는 미반응) 최대
    `max_retries` 회 Charge=1 을 재송신한다. state 2/5 도달 시 성공으로 보고 종료.

    ⚠️ charge_state 는 로봇 relay_charge.py 실행 시에만 유효(미실행 시 항상 0 → 매번 타임아웃·재시도).
    """
    from app.robot_io import runtime
    try:
        from app.navigation.send_move import is_nav_active
    except Exception:
        def is_nav_active() -> bool:
            return False

    rid = get_robot_id()
    total = max_retries + 1
    for attempt in range(1, total + 1):
        # 재시도 직전 로봇이 다시 주행을 시작했으면(도크 이탈 등) 재충전 시도 중단
        if attempt > 1 and is_nav_active():
            print("🔋 자동 충전 재시도 중단 — 로봇이 주행 중")
            return

        _send_start_charge_packet()  # Charge=1
        print(f"🔋 자동 충전 시도 {attempt}/{total} — Charge=1 송신, 충전 확인 대기({verify_timeout:.0f}s)")

        elapsed = 0.0
        saw_progress = False
        docked_state = 0
        while elapsed < verify_timeout:
            time.sleep(poll_interval)
            elapsed += poll_interval
            try:
                st = runtime.get_charge_state(rid) if rid else 0
            except Exception:
                st = 0
            if st in (2, 5):          # 충전 중 / 완충 도크 = 도킹 성공
                docked_state = st
                break
            if st == 1:               # 부두로 이동(도킹 진행) 관측
                saw_progress = True
            elif saw_progress and st == 0:  # state 1→0 = 도킹 실패 → 즉시 재시도
                print(f"[WARN] 도킹 실패 감지(state 1→0, 시도 {attempt}) — 재시도")
                break

        if docked_state in (2, 5):
            print(f"🔋 자동 충전 시작 확인 (state={docked_state}, 시도 {attempt})")
            log_event("robot", "robot_charging_start", "도킹 포인트 도착 — 자동 충전 시작",
                      robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id())
            return
        print(f"[WARN] 충전 미시작 (시도 {attempt}/{total}) — charge_state 2/5 미도달")

    print(f"[ERR] 자동 충전 {total}회 시도 모두 실패 — 충전 시작 안 됨(도킹 미완료)")
    log_event("error", "robot_charge_failed",
              f"자동 충전 실패 — {total}회 시도 후에도 충전 미시작(도킹 미완료)",
              robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id())


def prepare_undock_waypoints(
    max_wait_seconds: float = 20.0,
    poll_interval: float = 1.0,
) -> list[dict] | None:
    """작업 시작 전 충전 상태 확인 → 필요 시 해제 + 도킹 포인트 회전 웨이포인트 반환.

    로봇이 충전 중이면:
      1) stop-charge UDP 전송
      2) `runtime.is_charging` 이 False 가 될 때까지 `poll_interval` 초마다 폴링
         (최대 `max_wait_seconds` 초). 해제 확인되면 즉시 진행, 타임아웃이면 경고 로그 후 진행.
      3) 도킹 포인트(`<충전소>-1`) 에서 180° 회전 웨이포인트 1개 반환
         (해제 직후 로봇은 이미 도킹 포인트에 있으므로 이동 불필요 — 회전만)
    caller 는 반환된 preamble 을 자신의 작업 웨이포인트 앞에 붙여 nav_mod.waypoints_list 에 세팅.

    주의: is_charging 은 runtime 내부 디바운스(heartbeat 1초 간격, 연속 15회 필요) 적용된
    플래그라 물리적 해제 후에도 표시가 떨어지기까지 시간이 걸린다. 보통 10초 내에 해제
    신호가 반영되는 경우 정상 진행하고, 타임아웃이어도 진행해서 회전 명령을 보낸다.

    Returns:
        list[dict] — preamble 웨이포인트 (1개): 도킹 포인트에서 180° 회전
        None       — 충전 중 아님, 또는 도킹 포인트 데이터 미등록, 또는 실패
    """
    import math
    from app.robot_io import runtime
    from app.database.models import LocationInfo

    rid = get_robot_id()
    if not rid:
        return None

    try:
        charging = runtime.is_charging(rid)
    except Exception as e:
        print(f"[WARN] is_charging 조회 실패: {e}")
        return None
    if not charging:
        return None

    # 1) stop-charge 패킷 전송
    if not _send_stop_charge_packet():
        return None
    log_event(
        "robot", "charge_release_auto",
        "작업 시작 전 충전 자동 해제",
        robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id(),
    )
    print(f"🔋 stop-charge 전송 — 해제 확인 대기 (최대 {max_wait_seconds:.0f}s)")

    # 2) is_charging 이 False 가 될 때까지 폴링
    elapsed = 0.0
    released = False
    while elapsed < max_wait_seconds:
        time.sleep(poll_interval)
        elapsed += poll_interval
        try:
            if not runtime.is_charging(rid):
                released = True
                break
        except Exception as e:
            print(f"[WARN] is_charging 폴링 실패: {e}")
            break

    if released:
        print(f"🔋 충전 해제 확인됨 ({elapsed:.1f}s) — 도킹 포인트로 이동 시작")
    else:
        print(f"[WARN] {max_wait_seconds:.0f}s 내 충전 해제 미확인 — 그래도 진행 (로봇 상태 확인 필요)")
        log_event(
            "robot", "charge_release_timeout",
            f"충전 해제 타임아웃 ({max_wait_seconds:.0f}s)",
            robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id(),
        )

    # 3) 도킹 포인트 조회 (로봇 현재 층 기준)
    db = SessionLocal()
    try:
        floor_id = _get_robot_floor_id(db)
        charge_station = _find_charge_station(db, floor_id)
        if not charge_station:
            print(f"[WARN] 현재 층(FloorId={floor_id})에 등록된 충전소 없음 — 도킹 preamble 생략")
            return None
        dock_name = f"{charge_station.LacationName}-1"
        dock_q = db.query(LocationInfo).filter(LocationInfo.LacationName == dock_name)
        if floor_id is not None:
            dock_q = dock_q.filter(LocationInfo.FloorId == floor_id)
        dock = dock_q.first()
        if not dock:
            print(f"[WARN] 도킹 포인트 '{dock_name}' 없음 — 도킹 preamble 생략")
            return None

        base_yaw = float(dock.Yaw or 0.0)
        # 180° 회전 yaw 계산, (-π, π] 로 정규화
        rotated_yaw = base_yaw + math.pi
        while rotated_yaw > math.pi:
            rotated_yaw -= 2 * math.pi
        while rotated_yaw <= -math.pi:
            rotated_yaw += 2 * math.pi

        # 해제 직후 로봇은 이미 도킹 포인트에 있으므로 이동 불필요 — 회전만
        preamble = [
            {
                "x": dock.LocationX,
                "y": dock.LocationY,
                "yaw": round(rotated_yaw, 3),
                "name": f"{dock_name} (180°)",
            },
        ]
        print(f"🔋 언도킹 preamble: {dock_name} 에서 180° 회전 후 작업 진행")
        return preamble
    finally:
        db.close()


def _return_to_charge_internal(cancel_running: bool = True) -> dict:
    """충전소 복귀 코어 로직.

    - cancel_running=True (수동 호출, /robot/return-to-charge):
      진행 중인 스케줄/네비게이션을 먼저 취소하고 STOP 명령을 보낸다.
    - cancel_running=False (작업 완료 후 자동 호출):
      네비게이션은 이미 종료된 상태이므로 바로 도킹 포인트 이동만 수행.

    Returns:
        {"ok": bool, "msg": str, "dock_point": str|None, "charge_station": str|None}
    """
    from app.navigation.send_move import navigation_send_next, _signal_nav_reset
    import app.navigation.send_move as nav
    from app.robot_io.sender import send_to_robot
    from app.scheduler.loop import cancel_active_schedule, get_active_schedule_id

    # 주의: 위치 미초기화(initpose_pending) 여도 충전복귀는 막지 않는다.
    #   배터리 방전 = 더 큰 사고이므로 충전소 복귀는 항상 시도해야 한다(충전소는 고정 목적지이고
    #   로봇 자체 도킹 정렬도 있어 위치가 약간 어긋나도 도킹 가능). 위치 미확정 시 주행을 막는
    #   안전 가드는 선택적 자율주행(장소이동·경로·스케줄)에만 적용한다.

    db = SessionLocal()
    try:
        # 충전소(category=charge)를 로봇 현재 층 기준으로 선택 → 도킹 포인트는 "{충전소이름}-1"
        floor_id = _get_robot_floor_id(db)
        charge_station = _find_charge_station(db, floor_id)
        if not charge_station:
            msg = (f"현재 층(FloorId={floor_id})에 등록된 충전소가 없습니다."
                   if floor_id is not None else "등록된 충전소가 없습니다.")
            return {"ok": False, "msg": msg,
                    "dock_point": None, "charge_station": None}

        dock_name = f"{charge_station.LacationName}-1"

        # 충전소 접근 통로: "<충전소>-N" 웨이포인트를 전부 모아 번호 내림차순으로
        # 경유한다(ch-3 → ch-2 → ch-1). 운영자가 벽/꺾인 길목을 피해 ch-2, ch-3...를
        # 추가로 찍어두면 코드 변경 없이 자동으로 그 통로를 따라 도킹한다.
        # N=1(ch-1)이 물리적 도킹/충전 지점이며 경로의 마지막이다(여기서 start_charge).
        # 같은 이름의 충전소가 다른 층에도 있을 수 있으므로 접근점도 현재 층으로 필터한다.
        prefix = f"{charge_station.LacationName}-"
        approach_q = db.query(LocationInfo).filter(LocationInfo.LacationName.like(f"{prefix}%"))
        if floor_id is not None:
            approach_q = approach_q.filter(LocationInfo.FloorId == floor_id)
        numbered: list[tuple[int, LocationInfo]] = []
        for row in approach_q.all():
            suffix = row.LacationName[len(prefix):]
            if suffix.isdigit():
                numbered.append((int(suffix), row))
        # 바깥(큰 번호) → 도킹(ch-1) 순서
        numbered.sort(key=lambda t: t[0], reverse=True)

        dock_point = next((row for n, row in numbered if n == 1), None)
        if dock_point is None:
            return {"ok": False, "msg": f"도킹 포인트 '{dock_name}'을(를) 찾을 수 없습니다.",
                    "dock_point": None, "charge_station": charge_station.LacationName}

        if cancel_running:
            # 1) 진행 중인 스케줄 취소 (대기로 되돌림)
            if get_active_schedule_id() is not None:
                cancel_active_schedule("충전소 이동")

            # 2) 진행 중인 네비게이션 정지
            if nav.is_navigating:
                nav.is_navigating = False
                nav.current_wp_index = 0
                nav.nav_loop_remaining = 0
                nav.charge_on_arrival = False
                _signal_nav_reset(full=True)
                print("🛑 작업 복귀: 기존 네비게이션 정지")

            # 3) 로봇 정지 명령
            try:
                send_to_robot("STOP")
            except Exception as e:
                print(f"[WARN] STOP 전송 실패: {e}")

            time.sleep(1)  # 로봇 정지 대기

        # 현재 위치가 이미 도킹 포인트(ch-1) 근처면 접근 경유지(ch-2, ch-3...)를 생략하고
        # 도킹 포인트로 직행한다. (이미 도킹 영역에 있는데 바깥 경유지로 나갔다 오는 낭비
        # 방지). 위치 미초기화/미수신이면 판정하지 않고 안전하게 전체 경유 루트를 쓴다.
        route_numbered = numbered
        if len(numbered) > 1:
            try:
                from app.robot_io import runtime
                pos = runtime.get_position(get_robot_id())
                if not pos.get("initpose_pending") and pos.get("timestamp"):
                    dx = pos["x"] - dock_point.LocationX
                    dy = pos["y"] - dock_point.LocationY
                    dist = (dx * dx + dy * dy) ** 0.5
                    if dist <= AT_DOCK_THRESHOLD_M:
                        route_numbered = [(1, dock_point)]
                        print(
                            f"🔋 현재 위치가 도킹 포인트 근처({dist * 100:.0f}cm ≤ "
                            f"{AT_DOCK_THRESHOLD_M * 100:.0f}cm) — 접근 경유지 생략, 도킹 포인트 직행"
                        )
            except Exception as e:
                print(f"[WARN] 도킹 근접 판정 실패 — 전체 경유 루트 사용: {e}")

        # 접근 통로(ch-N 내림차순) → 도킹(ch-1) 순으로 웨이포인트 구성.
        # 도착 후 자동 충전은 마지막 점(ch-1)에서 navigation_send_next가 처리한다.
        # 운영자가 ch-2/ch-3를 추가하기 전(ch-1만 존재)이면 도킹점 직행으로 동작한다.
        nav.waypoints_list = [
            {
                "x": row.LocationX,
                "y": row.LocationY,
                "yaw": row.Yaw or 0.0,
                "name": row.LacationName,
            }
            for _, row in route_numbered
        ]
        # [충전 복귀 전용] 도킹 포인트(ch-1) 도착 WP 의 yaw 를 등록된 충전소 정면 yaw 로 지정해,
        #   도착과 동시에 충전소를 바라보게 한다 → 별도 '제자리 정렬' 네비게이션을 생략(2회 → 1회).
        #   (언도킹으로 나갈 때는 prepare_undock_waypoints 의 회전 WP 를 그대로 유지한다.)
        if nav.waypoints_list:
            nav.waypoints_list[-1]["yaw"] = dock_point.Yaw or 0.0
            nav.waypoints_list[-1]["name"] = dock_name
        route_label = " → ".join(row.LacationName for _, row in route_numbered)
        nav.current_wp_index = 0
        nav.is_navigating = True
        nav.nav_loop_remaining = 0
        nav.nav_loop_total = 0
        nav.nav_loop_infinite = False  # 무한 반복 중이었더라도 충전 복귀가 우선
        nav.charge_on_arrival = True
        nav.auto_return_to_charge = False  # 이미 복귀 중 — 중복 트리거 방지
        _signal_nav_reset(full=True)

        print(
            f"🔋 충전소 복귀 시작: {route_label} "
            f"(도킹 x={dock_point.LocationX}, y={dock_point.LocationY})"
        )
        log_event("schedule", "return_to_charge",
                  f"충전소 복귀 시작: {route_label}",
                  robot_id=get_robot_id(), robot_name=get_robot_name(), business_id=get_robot_business_id())

        navigation_send_next()
        return {
            "ok": True,
            "msg": f"{dock_name}(으)로 이동 시작 (도착 후 자동 충전)",
            "dock_point": dock_name,
            "charge_station": charge_station.LacationName,
        }
    finally:
        db.close()


@router.post("/robot/return-to-charge")
def return_to_charge():
    """작업 복귀: 진행 중인 작업 정지 → 도킹 포인트로 이동 → 도착 후 충전 명령 자동 실행."""
    result = _return_to_charge_internal(cancel_running=True)
    if result["ok"]:
        return {
            "status": "ok",
            "msg": result["msg"],
            "dock_point": result["dock_point"],
            "charge_station": result["charge_station"],
        }
    return {"status": "error", "msg": result["msg"]}


def _get_dock_point_waypoint() -> dict | None:
    """현재 층 충전소의 도킹 포인트 '{충전소}-1'(예: ch03-1) 웨이포인트 {x,y,yaw,name}. 없으면 None.

    언도킹 후 이 지점으로 NAV 재정렬해 매번 고정된 위치/자세로 SIT 하기 위한 목표점.
    (충전 앵커 ch 가 아니라 그 앞 접근점 ch-1 — 대기·재도킹 준비 위치)
    """
    db = SessionLocal()
    try:
        floor_id = _get_robot_floor_id(db)
        station = _find_charge_station(db, floor_id)
        if not station:
            return None
        dock_name = f"{station.LacationName}-1"
        q = db.query(LocationInfo).filter(LocationInfo.LacationName == dock_name)
        if floor_id is not None:
            q = q.filter(LocationInfo.FloorId == floor_id)
        dock = q.first()
        if not dock or dock.LocationX is None or dock.LocationY is None:
            return None
        return {"x": dock.LocationX, "y": dock.LocationY,
                "yaw": float(dock.Yaw or 0.0), "name": dock_name}
    finally:
        db.close()


def _undock_internal(
    max_wait_seconds: float = 12.0,
    poll_interval: float = 1.0,
    recharge_wait_seconds: float = 30.0,
    stand_wait_seconds: float = 8.0,
) -> dict:
    """충전소 도킹에서 빠져나와 SIT 자세로 대기 전환.

    도크 물리 이탈은 로봇 펌웨어의 충전 상태머신(/CHARGE_STATUS) 전환으로 수행된다:
    **state 2(충전) → 3(도크에서 나가기) → 0(대기)**. 전용 'undock' 명령이 없으므로
    이 시퀀스를 거쳐야 로봇이 도크에서 나온다.

    절차:
      1) **완충 대기(비충전·state≠2)면 먼저 Charge=1(충전 재개)로 state 2 진입** —
         이미 Charge=0 인 상태에서는 stop-charge 만으로는 이탈 시퀀스가 돌지 않기 때문.
         (충전 중이면 이 단계 생략)
      2) stop-charge(Charge=0) 송신 → state 2→3(도크에서 나가기)→0 : 도크 물리 이탈
      3) 이탈 확인 폴링(state 0 복귀 또는 비충전, 최대 max_wait_seconds)
      4) Charge=2(상태 클리어) + runtime 충전 상태 능동 클리어(stale 방지)
      5) 도킹 포인트(ch-1)로 NAV 재정렬 → 도착 시 SIT (매번 고정된 위치/자세로 앉음).
         도킹 포인트 미등록 시 폴백: STAND(자세=1) 대기 후 제자리 SIT.

    Returns:
        {"ok": bool, "msg": str, "dock_point": str|None}
    """
    from app.robot_io import runtime
    from app.robot_io.sender import send_to_robot

    rid = get_robot_id()
    if not rid:
        return {"ok": False, "msg": "로봇을 찾을 수 없습니다.", "dock_point": None}

    def _state() -> int:
        try:
            return runtime.get_charge_state(rid)
        except Exception:
            return 0

    log_event("robot", "undock_start", "언도킹 시작: 도크 이탈 후 SIT 대기",
              robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id())

    # 1) 도크 이탈(2→3→0)은 state 2(충전 중)에서 Charge=0 을 받아야 돈다. 완충 트리클이면 state 가
    #    2↔5 를 오가므로 state==2 인 '초록 구간'을 기다렸다가 그 순간 Charge=0 을 보낸다.
    #    (Charge=1 로 충전을 유도해 보되, 완충이면 로봇이 자체 트리클 주기로만 state 2 에 들어가므로
    #     한 주기를 덮을 만큼 충분히 기다린다. is_charging 은 sticky 라 판정에 안 쓰고 실시간 state 로 판정.)
    if _state() != 2:
        _send_start_charge_packet()  # Charge=1 (충전 유도 nudge)
        print("🪑 언도킹: state≠2 → Charge=1 로 충전 유도, 초록 구간(state 2) 대기")
        elapsed = 0.0
        while elapsed < recharge_wait_seconds and _state() != 2:
            time.sleep(poll_interval)
            elapsed += poll_interval

    # 2) Charge=0 → state 2→3(도크에서 나가기)→0 : 도크 물리 이탈 트리거.
    #    반드시 state==2 인 순간에 보내야 이탈이 돈다(위에서 초록 구간까지 대기 후 즉시 송신).
    _send_stop_charge_packet()
    print("🪑 언도킹: 충전 해제(Charge=0) 송신 — 도크 이탈(state 2→3→0) 트리거")

    # 3) 이탈 확인 폴링 — state 0(대기) 복귀(나가기 3 거쳐 대기 0). is_charging 은 sticky 라 게이트에 안 쓴다.
    elapsed = 0.0
    while elapsed < max_wait_seconds:
        time.sleep(poll_interval)
        elapsed += poll_interval
        if _state() == 0:
            print(f"🔋 도크 이탈 확인(state=0) ({elapsed:.1f}s)")
            break

    # 4) Charge=2 클리어 + runtime 능동 클리어 (stale 고정 방지)
    _send_charge_clear_packet()
    try:
        runtime.clear_charge_state(rid)
    except Exception as e:
        print(f"[WARN] charge_state 클리어 실패: {e}")

    # 4.5) 이탈 동작이 끝나 STAND(자세=1)로 설 때까지 대기 — 움직이는 중 NAV 재정렬/SIT 이
    #      나가는 것을 방지(재정렬·폴백 둘 다 이 대기 후 진행).
    stand_elapsed = 0.0
    stood = False
    while stand_elapsed < stand_wait_seconds:
        try:
            if runtime.get_motion_state(rid) == 1:  # 1 = STAND
                stood = True
                break
        except Exception:
            break
        time.sleep(poll_interval)
        stand_elapsed += poll_interval
    print(f"🪑 언도킹: {'STAND 확인' if stood else 'STAND 미확인(타임아웃)'} ({stand_elapsed:.0f}s)")

    # 5) 도킹 포인트(ch-1)로 NAV 재정렬 후 도착 시 SIT — 매번 고정된 위치/자세로 앉게 한다.
    #    (이탈 동작이 끝난 임의 지점에 앉지 않도록, 등록된 도킹 포인트로 이동 후 SIT.)
    dock_wp = _get_dock_point_waypoint()
    if dock_wp is not None:
        import app.navigation.send_move as nav
        from app.navigation.send_move import navigation_send_next, _signal_nav_reset
        nav.waypoints_list = [dock_wp]
        nav.current_wp_index = 0
        nav.is_navigating = True
        nav.nav_loop_remaining = 0
        nav.nav_loop_total = 0
        nav.nav_loop_infinite = False
        nav.charge_on_arrival = False
        nav.sit_on_arrival = True          # 도착 시 SIT (navigation_send_next 가 처리)
        nav.auto_return_to_charge = False
        _signal_nav_reset(full=True)
        print(f"🪑 언도킹: STAND 후 도킹 포인트({dock_wp['name']})로 재정렬 → 도착 시 SIT")
        navigation_send_next()
        log_event("robot", "undock_complete",
                  f"언도킹 — STAND 후 도킹 포인트({dock_wp['name']}) 재정렬 후 SIT",
                  robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id())
        return {"ok": True,
                "msg": f"도크 이탈 후 도킹 포인트({dock_wp['name']})로 재정렬해 SIT 합니다.",
                "dock_point": dock_wp["name"]}

    # 폴백(도킹 포인트 미등록): 제자리 SIT (위에서 STAND 대기 완료)
    try:
        send_to_robot("SIT")
    except Exception as e:
        print(f"[ERR] SIT 자세 명령 실패: {e}")
    print("🪑 언도킹 완료 — 제자리 SIT 대기")
    log_event("robot", "undock_complete", "언도킹 완료 — 제자리 SIT 대기",
              robot_id=rid, robot_name=get_robot_name(), business_id=get_robot_business_id())

    return {"ok": True, "msg": "도크에서 이탈해 SIT 대기로 전환합니다.", "dock_point": None}


@router.post("/robot/undock")
def undock():
    """충전소 도킹에서 빠져나와 SIT 자세로 대기.

    기존 '충전 해제'(Charge=0)와 동일하게 도크를 이탈시키고 SIT 까지 수행한다.
    충전 중·완충 후 대기 어느 상태에서도 호출 가능.
    """
    result = _undock_internal()
    if result["ok"]:
        return {"status": "ok", "msg": result["msg"], "dock_point": result["dock_point"]}
    return {"status": "error", "msg": result["msg"]}
