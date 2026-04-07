import time
import threading
import queue
from datetime import datetime, timedelta

from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.Database.models import LogDataInfo, Alert
from app.Database.database import SessionLocal

# ── 중복 로그 억제 (쿨다운) ──
_cooldown_lock = threading.Lock()
_last_logged: dict[str, float] = {}       # action → 마지막 기록 시각
_suppressed_counts: dict[str, int] = {}   # action → 억제된 횟수
LOG_COOLDOWN_SEC = 30                     # 같은 action 반복 억제 시간(초)
# 쿨다운 예외: 매번 기록되어야 하는 action (알림 Detail에 누적)
_COOLDOWN_EXEMPT = {"nav_arrival", "nav_loop", "nav_complete", "nav_error"}

# ── 큐 기반 단일 Writer ──
_log_queue: queue.Queue = queue.Queue(maxsize=500)

# 로그 Action → 알림 자동 생성 규칙
ALERT_TRIGGER_RULES = {
    # Action: (alert Type, alert Status)
    "robot_battery_low":       ("Robot", "error"),
    "robot_connection_error":  ("Robot", "error"),
    "rtsp_error":              ("Robot", "error"),
    "nav_error":               ("Schedule", "error"),
    "remote_send_error":       ("Robot", "error"),
    "robot_error_code":        ("Robot", "error"),
}

# 로그 Action → 알림 제목 매핑
ACTION_TITLES = {
    # Robot
    "robot_error_code":        "로봇 에러",
    "robot_battery_low":       "배터리 부족",
    "robot_connection_error":  "로봇 연결 오류",
    "robot_charging_start":    "충전 시작",
    "robot_charging_complete": "충전 완료",
    "rtsp_error":              "카메라 오류",
    "remote_send_error":       "원격 제어 오류",
    "nav_poll_timeout":        "네비게이션 폴링 타임아웃",
    "position_recv_error":     "위치 수신 오류",
    "db_operation_error":      "데이터베이스 오류",
    # Schedule
    "nav_start":               "네비게이션 시작",
    "nav_arrival":             "웨이포인트 도착",
    "nav_complete":            "네비게이션 완료",
    "nav_error":               "네비게이션 오류",
    "nav_loop":                "네비게이션 반복",
    "place_move_start":        "장소 이동",
    "path_move_start":         "경로 이동",
    "robot_online":            "로봇 온라인",
    "robot_offline":           "로봇 오프라인",
    # System
    "system_startup":          "서버 시작",
}


class LogService:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        category: str,
        action: str,
        message: str,
        detail: str = None,
        robot_id: int = None,
        robot_name: str = None,
        error_json: str = None,
    ) -> LogDataInfo:
        log = LogDataInfo(
            Category=category,
            Action=action,
            Message=message,
            Detail=detail,
            RobotId=robot_id,
            RobotName=robot_name,
        )
        self.db.add(log)
        self.db.flush()

        # 알림 자동 생성 규칙 확인
        rule = ALERT_TRIGGER_RULES.get(action)
        if rule:
            alert_type, alert_status = rule
            alert_title = ACTION_TITLES.get(action, message)
            alert = Alert(
                Type=alert_type,
                Status=alert_status,
                Content=alert_title,
                Detail=message,
                ErrorJson=error_json or detail,
                RobotName=robot_name,
                LogId=log.id,
            )
            self.db.add(alert)

        self.db.commit()
        self.db.refresh(log)
        return log

    def get_list(
        self,
        category: str = None,
        search: str = None,
        start_date: str = None,
        end_date: str = None,
        page: int = 1,
        size: int = 20,
    ):
        query = self.db.query(LogDataInfo)

        # 로봇 온라인/오프라인 로그는 목록에서 제외 (통계용으로만 사용)
        query = query.filter(
            LogDataInfo.Action.notin_(["robot_online", "robot_offline"])
        )

        if category:
            query = query.filter(LogDataInfo.Category == category)
        if search:
            query = query.filter(LogDataInfo.Message.contains(search))
        if start_date:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(LogDataInfo.CreatedAt >= start_dt)
        if end_date:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
            query = query.filter(LogDataInfo.CreatedAt <= end_dt)

        total = query.count()
        items = (
            query.order_by(desc(LogDataInfo.CreatedAt))
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )

        return {"items": items, "total": total, "page": page, "size": size}


# ── 큐 Writer 스레드 (세션 1개 재사용) ──
def _log_writer():
    """큐에서 로그를 꺼내 단일 세션으로 DB에 기록하는 전용 스레드"""
    db = None
    fail_count = 0

    while True:
        try:
            item = _log_queue.get()  # 블로킹 대기

            # 세션이 없거나 이전에 실패했으면 (재)생성
            if db is None:
                try:
                    db = SessionLocal()
                    fail_count = 0
                except Exception as e:
                    print(f"[ERR log_writer] DB 세션 생성 실패: {e}")
                    fail_count += 1
                    time.sleep(min(fail_count * 2, 30))
                    continue

            try:
                LogService(db).create(**item)
            except Exception as e:
                print(f"[ERR log_writer] {e}")
                try:
                    db.rollback()
                except Exception:
                    pass
                # 세션이 깨졌으면 폐기 후 다음 루프에서 재생성
                try:
                    db.close()
                except Exception:
                    pass
                db = None

        except Exception as e:
            print(f"[ERR log_writer] unexpected: {e}")


# Writer 스레드 시작 (데몬 — 메인 프로세스 종료 시 같이 종료)
threading.Thread(target=_log_writer, daemon=True, name="log-writer").start()


def log_event(
    category: str,
    action: str,
    message: str,
    detail: str = None,
    robot_id: int = None,
    robot_name: str = None,
    error_json: str = None,
):
    """스레드에서 안전하게 로그를 큐에 추가 (동일 action 30초 쿨다운)"""
    now = time.time()

    if action not in _COOLDOWN_EXEMPT:
        with _cooldown_lock:
            last = _last_logged.get(action, 0)
            if now - last < LOG_COOLDOWN_SEC:
                _suppressed_counts[action] = _suppressed_counts.get(action, 0) + 1
                return
            suppressed = _suppressed_counts.pop(action, 0)
            _last_logged[action] = now

        if suppressed > 0:
            message = f"{message} (이전 {suppressed}건 동일 로그 생략됨)"

    item = dict(
        category=category,
        action=action,
        message=message,
        detail=detail,
        robot_id=robot_id,
        robot_name=robot_name,
        error_json=error_json,
    )

    try:
        _log_queue.put_nowait(item)
    except queue.Full:
        print("[WARN log_event] 로그 큐 가득참 — 드롭")
