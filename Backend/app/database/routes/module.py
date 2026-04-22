from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from app.database.models import RobotInfo, UserInfo, RobotModule, ModuleCameraInfo
from app.auth.dependencies import require_permission, require_any_permission
from app.auth.audit import write_audit, get_client_ip

from app.database.routes import database, get_db


def _build_module_tree(modules: list[RobotModule], robot: RobotInfo) -> list[dict]:
    """flat 모듈 목록을 트리 구조로 변환"""
    by_id = {}
    roots = []

    for m in modules:
        node = {
            "id": m.id,
            "type": m.ModuleType,
            "label": m.Label,
            "parentModuleId": m.ParentModuleId,
            "isBuiltIn": bool(m.IsBuiltIn),
            "isActive": bool(m.IsActive),
            "sortOrder": m.SortOrder,
            "createdAt": m.CreatedAt.strftime("%Y-%m-%d %H:%M") if m.CreatedAt else None,
            "config": None,
            "children": [],
        }

        if m.ModuleType == "camera" and m.camera_info:
            ci = m.camera_info
            ip = ci.CameraIP or robot.RobotIP
            if ci.StreamType == "ws":
                stream_url = f"ws://{ip}:{ci.Port}"
            else:
                stream_url = f"/Video/{m.id}"
            node["config"] = {
                "streamType": ci.StreamType,
                "streamUrl": stream_url,
                "cameraIP": ip,
                "port": ci.Port,
                "path": ci.Path,
            }

        by_id[m.id] = node

    for node in by_id.values():
        pid = node["parentModuleId"]
        if pid and pid in by_id:
            by_id[pid]["children"].append(node)
        else:
            roots.append(node)

    sort_key = lambda n: (n["sortOrder"], n["id"])
    roots.sort(key=sort_key)
    for node in by_id.values():
        if node["children"]:
            node["children"].sort(key=sort_key)

    return roots


@database.get("/robots/{robot_id}/modules")
def get_robot_modules(
    robot_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("dashboard", "robot-list")),
):
    robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    modules = (
        db.query(RobotModule)
        .filter(RobotModule.RobotId == robot_id)
        .order_by(RobotModule.SortOrder, RobotModule.id)
        .all()
    )

    return {"modules": _build_module_tree(modules, robot)}


class ModuleCreateReq(BaseModel):
    moduleType: str                     # "camera", "arm", "gripper", "sensor"
    label: str
    parentModuleId: Optional[int] = None
    sortOrder: int = 0
    # 카메라 전용
    streamType: Optional[str] = None    # "rtsp" | "ws"
    cameraIP: Optional[str] = None
    port: Optional[int] = None
    path: Optional[str] = None


@database.post("/robots/{robot_id}/modules")
def create_module(
    robot_id: int,
    req: ModuleCreateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="Robot not found")

    if req.parentModuleId:
        parent = db.query(RobotModule).filter(
            RobotModule.id == req.parentModuleId,
            RobotModule.RobotId == robot_id,
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent module not found")

    module = RobotModule(
        RobotId=robot_id,
        ParentModuleId=req.parentModuleId,
        ModuleType=req.moduleType,
        Label=req.label,
        IsBuiltIn=0,
        SortOrder=req.sortOrder,
    )
    db.add(module)
    db.flush()

    if req.moduleType == "camera" and req.streamType:
        db.add(ModuleCameraInfo(
            ModuleId=module.id,
            StreamType=req.streamType,
            CameraIP=req.cameraIP,
            Port=req.port,
            Path=req.path,
        ))

    db.commit()

    write_audit(db, current_user.id, "module_created", "module", module.id,
                detail=f"타입: {req.moduleType}, 라벨: {req.label}, 로봇ID: {robot_id}",
                ip_address=get_client_ip(request))

    return {"status": "ok", "id": module.id}


class ModuleUpdateReq(BaseModel):
    label: Optional[str] = None
    sortOrder: Optional[int] = None
    isActive: Optional[int] = None
    # 카메라 전용
    streamType: Optional[str] = None
    cameraIP: Optional[str] = None
    port: Optional[int] = None
    path: Optional[str] = None


@database.put("/modules/{module_id}")
def update_module(
    module_id: int,
    req: ModuleUpdateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    module = db.query(RobotModule).filter(RobotModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    if req.label is not None:
        module.Label = req.label
    if req.sortOrder is not None:
        module.SortOrder = req.sortOrder
    if req.isActive is not None:
        module.IsActive = req.isActive

    if module.ModuleType == "camera" and module.camera_info:
        ci = module.camera_info
        if req.streamType is not None:
            ci.StreamType = req.streamType
        if req.cameraIP is not None:
            ci.CameraIP = req.cameraIP or None
        if req.port is not None:
            ci.Port = req.port
        if req.path is not None:
            ci.Path = req.path

    db.commit()

    write_audit(db, current_user.id, "module_updated", "module", module_id,
                ip_address=get_client_ip(request))

    return {"status": "ok"}


@database.delete("/modules/{module_id}")
def delete_module(
    module_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("robot-list")),
):
    module = db.query(RobotModule).filter(RobotModule.id == module_id).first()
    if not module:
        raise HTTPException(status_code=404, detail="Module not found")

    if module.IsBuiltIn:
        raise HTTPException(status_code=400, detail="내장 모듈은 삭제할 수 없습니다")

    label = module.Label
    db.delete(module)
    db.commit()

    write_audit(db, current_user.id, "module_deleted", "module", module_id,
                detail=f"라벨: {label}",
                ip_address=get_client_ip(request))

    return {"status": "ok"}
