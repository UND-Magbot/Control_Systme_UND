from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from fastapi.encoders import jsonable_encoder

from app.database.models import (
    RobotInfo, UserInfo, RobotModule, ModuleCameraInfo,
    RobotLastStatus, BusinessInfo, RobotEndpoint,
)
from app.auth.dependencies import require_permission, require_any_permission, is_admin
from app.auth.audit import write_audit, get_client_ip
from app.robot_io.runtime import _derive_network, _derive_power
import app.robot_io.runtime as runtime
import app.robot_io.endpoints as endpoints

from app.database.routes import database, get_db
from app.database.routes._helpers import get_floor_name


# =========================
# Robot INSERT
# =========================
class EndpointIn(BaseModel):
    role: str                          # receiver | robot | motion | perception | nav | local
    ip: Optional[str] = None
    udp_port: Optional[int] = None
    tcp_port: Optional[int] = None
    extra: Optional[dict] = None


class RobotInsertReq(BaseModel):
    robot_id: str
    robot_name: str
    robot_model: str
    robot_type: Optional[str] = None
    limit_battery: int = 30
    business_id: Optional[int] = None
    sw_version: Optional[str] = None
    # 로봇 대표 IP. 폴링 결과를 어느 로봇에 붙일지 정하는 키다
    # (runtime.get_robot_id_by_ip → RobotInfo.RobotIP). 비우면 그 로봇은 상태를 못 받는다.
    robot_ip: Optional[str] = None
    # 로봇별 통신 엔드포인트(다중 IP/포트). 미지정 시 리졸버가 env 전역으로 폴백.
    endpoints: Optional[list[EndpointIn]] = None


def _can_see_ip(user: UserInfo) -> bool:
    """로봇 IP 는 관리자(Permission 1·2)만 보고 바꾼다.

    통신 대상 주소는 잘못 바뀌면 로봇이 통째로 offline 이 되고, 다른 장비를 가리키면
    엉뚱한 로봇에 명령이 나간다. 일반 사용자에게는 응답에서 아예 뺀다 —
    화면에서 감추는 것만으로는 방어가 되지 않는다.
    """
    return user.Permission in (1, 2)


def _upsert_endpoints(db: Session, robot_id: int, items: list[EndpointIn]) -> None:
    """(role) 단위 업서트. 유효하지 않은 role 은 무시한다."""
    for ep in items:
        if ep.role not in endpoints.VALID_ROLES:
            raise HTTPException(status_code=422, detail=f"유효하지 않은 엔드포인트 role: {ep.role}")
    for ep in items:
        row = (
            db.query(RobotEndpoint)
            .filter(RobotEndpoint.RobotId == robot_id, RobotEndpoint.Role == ep.role)
            .first()
        )
        if row is None:
            row = RobotEndpoint(RobotId=robot_id, Role=ep.role)
            db.add(row)
        row.Ip = ep.ip
        row.UdpPort = ep.udp_port
        row.TcpPort = ep.tcp_port
        row.Extra = ep.extra
    endpoints.invalidate(robot_id)


@database.post("/RobotInsert")
def insert_Robot(req: RobotInsertReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    exists = (
        db.query(RobotInfo)
        .filter(RobotInfo.SerialNumber == req.robot_id)
        .first()
    )

    if exists:
        raise HTTPException(
            status_code=409,
            detail="이미 등록된 시리얼 넘버입니다."
        )

    robot = RobotInfo(
        UserId=current_user.id,
        RobotName=req.robot_name,
        RobotType=req.robot_type,
        ModelName=req.robot_model,
        LimitBattery=req.limit_battery,
        SerialNumber=req.robot_id,
        BusinessId=req.business_id,
        SWversion=req.sw_version,
        # 로봇 IP 는 관리자(Permission 1·2)만 설정한다. 일반 사용자가 보낸 값은 무시한다
        # — UI 숨김은 방어가 아니다(IMP-SEC-03).
        RobotIP=((req.robot_ip or "").strip() or None
                 if current_user.Permission in (1, 2) else None),
    )

    db.add(robot)
    db.flush()

    # 로봇 타입별 내장 카메라 자동 생성
    from app.database.seed import DEFAULT_BUILT_IN_CAMERAS
    for idx, (label, path) in enumerate(DEFAULT_BUILT_IN_CAMERAS.get(req.robot_type or "", [])):
        module = RobotModule(
            RobotId=robot.id, ModuleType="camera", Label=label,
            IsBuiltIn=1, SortOrder=idx,
        )
        db.add(module)
        db.flush()
        db.add(ModuleCameraInfo(ModuleId=module.id, StreamType="rtsp", Port=8554, Path=path))

    # 로봇별 통신 엔드포인트 등록(선택). 미지정 시 리졸버가 env 전역으로 폴백.
    if req.endpoints:
        _upsert_endpoints(db, robot.id, req.endpoints)

    db.commit()
    db.refresh(robot)

    # 런타임에 즉시 반영 (서버 재시작 불필요)
    import app.robot_io.runtime as runtime
    runtime.add_or_update_robot(robot)

    write_audit(db, current_user.id, "robot_created", "robot", robot.id,
                detail=f"로봇명: {req.robot_name}, 시리얼: {req.robot_id}, 모델: {req.robot_model}",
                ip_address=get_client_ip(request))

    return {"status": "ok"}


@database.get("/robots")
def get_robots(db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list", "schedule-list"))):
    q = (
        db.query(RobotInfo, RobotLastStatus, BusinessInfo.BusinessName)
        .outerjoin(RobotLastStatus, RobotInfo.id == RobotLastStatus.RobotId)
        .outerjoin(BusinessInfo, RobotInfo.BusinessId == BusinessInfo.id)
    )
    if not is_admin(current_user) and current_user.BusinessId:
        q = q.filter(RobotInfo.BusinessId == current_user.BusinessId)
    rows = q.order_by(RobotInfo.id.asc()).all()
    result = []
    for robot, status, biz_name in rows:
        data = jsonable_encoder(robot)
        data["ProductCompany"] = biz_name or robot.ProductCompany
        if status:
            data["BatteryLevel1"] = status.BatteryLevel1
            data["BatteryLevel2"] = status.BatteryLevel2
            data["Voltage1"] = status.Voltage1
            data["Voltage2"] = status.Voltage2
            data["BatteryTemp1"] = status.BatteryTemp1
            data["BatteryTemp2"] = status.BatteryTemp2
            data["IsCharging1"] = status.IsCharging1
            data["IsCharging2"] = status.IsCharging2
            data["PosX"] = status.PosX
            data["PosY"] = status.PosY
            data["PosYaw"] = status.PosYaw
            data["LastHeartbeat"] = status.LastHeartbeat.isoformat() if status.LastHeartbeat else None
        # Network/Power 는 in-memory runtime의 last_heartbeat를 우선 사용.
        # DB의 LastHeartbeat는 폴링 시 갱신되지 않아 stale — 사용 금지.
        rt_entry = runtime._runtime.get(robot.id)
        rt_last_hb = (rt_entry or {}).get("last_heartbeat") if rt_entry else None
        if rt_last_hb and rt_last_hb > 0:
            net = _derive_network(rt_last_hb)
        elif status and status.LastHeartbeat:
            net = _derive_network(status.LastHeartbeat.timestamp())
        else:
            net = "-"
        data["Network"] = net
        # Power/Sleep/PowerManagement는 runtime의 in-memory basic_status에서 조회
        basic = (rt_entry or {}).get("basic_status") if rt_entry else None
        rt_battery = (rt_entry or {}).get("battery") if rt_entry else None
        data["Power"] = _derive_power(basic, rt_battery, net)
        sleep_val = (basic or {}).get("Sleep") if basic else None
        data["Sleep"] = sleep_val
        data["PowerManagement"] = (basic or {}).get("PowerManagement") if basic and sleep_val == 0 else None
        data["MotionState"] = (basic or {}).get("MotionState") if basic else None
        if not _can_see_ip(current_user):
            data.pop("RobotIP", None)
        result.append(data)
    return result


@database.get("/robots/{robot_id}")
def get_robot_by_id(robot_id: int, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list"))):
    row = (
        db.query(RobotInfo, BusinessInfo.BusinessName)
        .outerjoin(BusinessInfo, RobotInfo.BusinessId == BusinessInfo.id)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not row:
        raise HTTPException(status_code=404, detail="Robot not found")

    robot, biz_name = row
    data = jsonable_encoder(robot)
    data["ProductCompany"] = biz_name or robot.ProductCompany
    if not _can_see_ip(current_user):
        data.pop("RobotIP", None)
    return data


class RobotUpdateReq(BaseModel):
    robotName: str | None = None
    operator: str | None = None
    serialNumber: str | None = None
    model: str | None = None
    group: str | None = None
    softwareVersion: str | None = None
    site: str | None = None
    limit_battery: int | None = None
    business_id: int | None = None
    current_floor_id: int | None = None
    robot_type: str | None = None
    robot_ip: str | None = None


@database.put("/robots/{robot_id}")
def update_robot(
    robot_id: int,
    req: RobotUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    changes = []
    field_map = {
        "로봇명": ("RobotName", req.robotName),
        "제조사": ("ProductCompany", req.operator),
        "시리얼번호": ("SerialNumber", req.serialNumber),
        "모델": ("ModelName", req.model),
        "그룹": ("Group", req.group),
        "SW버전": ("SWversion", req.softwareVersion),
        "사이트": ("Site", req.site),
        "배터리제한": ("LimitBattery", req.limit_battery),
        "사업장": ("BusinessId", req.business_id),
        "현재층": ("CurrentFloorId", req.current_floor_id),
        "로봇타입": ("RobotType", req.robot_type),
        # 빈 문자열도 그대로 반영한다 — 잘못 넣은 IP 를 지울 수 있어야 한다.
        # (None 은 "안 보냄"이라 아래 루프에서 건너뛴다.)
        # 관리자(Permission 1·2)만 변경 가능 — 비관리자가 보낸 값은 None 으로 눌러 무시한다.
        "로봇IP": ("RobotIP",
                   req.robot_ip.strip()
                   if (req.robot_ip is not None and current_user.Permission in (1, 2))
                   else None),
    }

    for label, (attr, new_val) in field_map.items():
        if new_val is None:
            continue
        old_val = getattr(robot, attr)
        if old_val != new_val:
            if attr == "CurrentFloorId":
                old_name = get_floor_name(db, old_val)
                new_name = get_floor_name(db, new_val)
                changes.append(f"현재층: {old_name} → {new_name}")
            else:
                changes.append(f"{label}: {old_val or ''} → {new_val}")
            setattr(robot, attr, new_val)

    db.commit()
    db.refresh(robot)

    # 런타임에 즉시 반영 (서버 재시작 불필요)
    import app.robot_io.runtime as runtime
    runtime.add_or_update_robot(robot)

    detail = ", ".join(changes) if changes else None
    write_audit(db, current_user.id, "robot_updated", "robot", robot_id, detail=detail,
                ip_address=get_client_ip(request))

    return {"status": "ok"}


@database.delete("/robots/{robot_id}")
def delete_robot(robot_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("robot-list"))):
    robot = (
        db.query(RobotInfo)
        .filter(RobotInfo.id == robot_id)
        .first()
    )

    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    robot_name = robot.RobotName
    db.delete(robot)
    db.commit()
    endpoints.invalidate(robot_id)

    write_audit(db, current_user.id, "robot_deleted", "robot", robot_id,
                detail=f"로봇명: {robot_name}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "deleted_id": robot_id}


# =========================
# Robot 통신 엔드포인트 (로봇별 다중 IP/포트)
# =========================
@database.get("/robots/{robot_id}/endpoints")
def get_robot_endpoints(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list")),
):
    """로봇의 역할별 통신 엔드포인트를 반환.

    - ``registered``: robot_endpoint 테이블에 실제 저장된 행
    - ``resolved``: 리졸버가 폴백(RobotInfo.RobotIP → env)까지 적용해 최종 사용할 값
    """
    if not db.query(RobotInfo).filter(RobotInfo.id == robot_id).first():
        raise HTTPException(status_code=404, detail="Robot not found")

    rows = db.query(RobotEndpoint).filter(RobotEndpoint.RobotId == robot_id).all()
    registered = [
        {"role": r.Role, "ip": r.Ip, "udp_port": r.UdpPort, "tcp_port": r.TcpPort, "extra": r.Extra}
        for r in rows
    ]
    resolved = {
        role: {"ip": ep.ip, "udp_port": ep.udp_port, "tcp_port": ep.tcp_port, "extra": ep.extra}
        for role, ep in endpoints.get_endpoints(robot_id, db=db).items()
    }
    return {"robot_id": robot_id, "registered": registered, "resolved": resolved}


@database.put("/robots/{robot_id}/endpoints")
def set_robot_endpoints(
    robot_id: int,
    items: list[EndpointIn],
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    """로봇의 통신 엔드포인트를 업서트(role 단위). 빈 목록이면 변경 없음."""
    if not db.query(RobotInfo).filter(RobotInfo.id == robot_id).first():
        raise HTTPException(status_code=404, detail="Robot not found")

    _upsert_endpoints(db, robot_id, items)
    db.commit()
    endpoints.invalidate(robot_id)

    detail = ", ".join(f"{ep.role}={ep.ip}:{ep.udp_port or ''}" for ep in items) or None
    write_audit(db, current_user.id, "robot_endpoints_updated", "robot", robot_id,
                detail=detail, ip_address=get_client_ip(request))
    return {"status": "ok", "count": len(items)}
