from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.Database.models import LogDataInfo, Alert
from app.Database.database import SessionLocal

# 로그 Action → 알림 자동 생성 규칙
ALERT_TRIGGER_RULES = {
    # Action: (alert Type, alert Status)
    "robot_battery_low":       ("Robot", "error"),
    "robot_connection_error":  ("Robot", "error"),
    "robot_charging_start":    ("Robot", "event"),
    "robot_charging_complete": ("Robot", "event"),
    "rtsp_error":              ("Robot", "error"),
    "nav_start":               ("Schedule", "info"),
    "nav_arrival":             ("Schedule", "info"),
    "nav_complete":            ("Schedule", "info"),
    "nav_error":               ("Robot", "error"),
    "nav_loop":                ("Schedule", "info"),
    "place_move_start":        ("Schedule", "info"),
    "path_move_start":         ("Schedule", "info"),
    "remote_send_error":       ("Robot", "error"),
    "nav_poll_timeout":        ("Robot", "error"),
    "position_recv_error":     ("Robot", "error"),
    "robot_error_code":        ("Robot", "error"),
    "db_operation_error":      ("Robot", "error"),
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

        if category:
            query = query.filter(LogDataInfo.Category == category)
        if search:
            query = query.filter(LogDataInfo.Message.contains(search))
        if start_date:
            query = query.filter(LogDataInfo.CreatedAt >= start_date)
        if end_date:
            query = query.filter(LogDataInfo.CreatedAt <= end_date)

        total = query.count()
        items = (
            query.order_by(desc(LogDataInfo.CreatedAt))
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )

        return {"items": items, "total": total, "page": page, "size": size}


def log_event(
    category: str,
    action: str,
    message: str,
    detail: str = None,
    robot_id: int = None,
    robot_name: str = None,
    error_json: str = None,
):
    """스레드에서 안전하게 로그를 생성하는 유틸리티 함수"""
    db = SessionLocal()
    try:
        LogService(db).create(
            category=category,
            action=action,
            message=message,
            detail=detail,
            robot_id=robot_id,
            robot_name=robot_name,
            error_json=error_json,
        )
    except Exception as e:
        print(f"[ERR log_event] {e}")
        db.rollback()
    finally:
        db.close()
