from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from fastapi.encoders import jsonable_encoder

from app.database.models import (
    RobotInfo, UserInfo, RobotModule, ModuleCameraInfo,
    RobotLastStatus, BusinessInfo,
)
from app.auth.dependencies import require_permission, require_any_permission, is_admin
from app.auth.audit import write_audit, get_client_ip
from app.robot_io.runtime import _derive_network, _derive_power
import app.robot_io.runtime as runtime

from app.database.routes import database, get_db
from app.database.routes._helpers import get_floor_name


# =========================
# Robot INSERT
# =========================
class RobotInsertReq(BaseModel):
    robot_id: str
    robot_name: str
    robot_model: str
    robot_type: Optional[str] = None
    limit_battery: int = 30
    business_id: Optional[int] = None
    sw_version: Optional[str] = None


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

    write_audit(db, current_user.id, "robot_deleted", "robot", robot_id,
                detail=f"로봇명: {robot_name}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "deleted_id": robot_id}
