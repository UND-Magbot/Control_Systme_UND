from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import os
import re
import time
import socket

from app.robot_io.protocol import build_packet
from app.database.database import get_db
from app.database.models import (
    RobotMapInfo, UserInfo, LocationInfo, RouteInfo, WayInfo, MapInitPose,
)
from app.auth.dependencies import get_current_user, require_permission
from app.auth.audit import write_audit, get_client_ip

router = APIRouter()


# =========================
# 스키마
# =========================
class MapSaveReq(BaseModel):
    BusinessId: int
    FloorId: int
    MapName: str


class ActivateMapReq(BaseModel):
    map_id: int
    robot_id: int


class SyncMapReq(BaseModel):
    map_id: int
    robot_id: int


# =========================
# 맵 CRUD
# =========================
@router.get("/maps")
def get_maps(
    floor_id: Optional[int] = None,
    business_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),  # 맵 뷰는 어느 탭에서든 표시 가능
):
    q = db.query(RobotMapInfo)
    if floor_id is not None:
        q = q.filter(RobotMapInfo.FloorId == floor_id)
    if business_id is not None:
        q = q.filter(RobotMapInfo.BusinessId == business_id)
    return q.order_by(RobotMapInfo.id.desc()).all()


@router.post("/maps")
def save_map(req: MapSaveReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    pgm_path = f"./static/maps/{req.MapName}.pgm"
    yaml_path = f"./static/maps/{req.MapName}.yaml"

    robot_map = RobotMapInfo(
        BusinessId=req.BusinessId,
        FloorId=req.FloorId,
        MapName=req.MapName,
        PgmFilePath=pgm_path,
        YamlFilePath=yaml_path,
    )
    db.add(robot_map)
    db.commit()
    db.refresh(robot_map)
    write_audit(db, current_user.id, "map_created", "map", robot_map.id,
                detail=f"맵명: {req.MapName}",
                ip_address=get_client_ip(request))
    return robot_map


@router.get("/maps/{map_id}/meta")
def get_map_meta(
    map_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),  # 맵 뷰는 어느 탭에서든 표시 가능
):
    """맵의 yaml 파싱해서 origin, resolution 반환"""
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")

    yaml_path = m.YamlFilePath
    if not yaml_path:
        raise HTTPException(status_code=404, detail="No yaml file")

    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    full_path = os.path.join(base_dir, yaml_path.replace("./", ""))

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"Yaml file not found: {full_path}")

    with open(full_path, "r") as f:
        content = f.read()

    resolution = 0.1
    origin_x, origin_y = 0.0, 0.0

    res_match = re.search(r"resolution:\s*([\d.]+)", content)
    if res_match:
        resolution = float(res_match.group(1))

    origin_match = re.search(r"origin:\s*\[([-\d.]+),\s*([-\d.]+)", content)
    if origin_match:
        origin_x = float(origin_match.group(1))
        origin_y = float(origin_match.group(2))

    return {
        "resolution": resolution,
        "originX": origin_x,
        "originY": origin_y,
    }


@router.delete("/maps/{map_id}")
def delete_map(map_id: int, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    map_name = m.MapName

    places = db.query(LocationInfo).filter(LocationInfo.MapId == map_id).all()
    place_names = {p.LacationName for p in places}

    if place_names:
        all_ways = db.query(WayInfo).all()
        for way in all_ways:
            wp_names = {n.strip() for n in (way.WayPoints or "").split(" - ")}
            if wp_names & place_names:
                db.delete(way)

    db.query(RouteInfo).filter(RouteInfo.MapId == map_id).delete()
    db.query(LocationInfo).filter(LocationInfo.MapId == map_id).delete()

    for path in [m.PgmFilePath, m.YamlFilePath, m.ImgFilePath]:
        if path:
            try:
                full = os.path.join(".", path) if not os.path.isabs(path) else path
                if os.path.exists(full):
                    os.remove(full)
            except Exception as e:
                print(f"[WARN] 맵 파일 삭제 실패: {path} — {e}")
    db.delete(m)
    db.commit()
    write_audit(db, current_user.id, "map_deleted", "map", map_id,
                detail=f"맵명: {map_name}",
                ip_address=get_client_ip(request))
    return {"status": "deleted"}


# =========================
# 활성 맵 변경 (로봇 NOS의 active 심볼릭 링크 교체)
# =========================
@router.post("/maps/activate")
def activate_map(req: ActivateMapReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    """로봇의 활성 맵을 변경하고, CurrentFloorId를 업데이트."""
    from app.database.models import RobotInfo
    from app.map.mapping_control import get_ssh_client, ssh_exec, NOS_MAP_BASE_DIR
    import app.robot_io.runtime as runtime

    # 맵 조회
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == req.map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="맵을 찾을 수 없습니다.")

    # 로봇 조회
    robot = db.query(RobotInfo).filter(RobotInfo.id == req.robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="로봇을 찾을 수 없습니다.")

    map_name = m.MapName
    client = None
    try:
        # SSH 실패 시 재접속하여 재시도 (최대 3회)
        activate_success = False
        map_dir = ""
        for attempt in range(3):
            try:
                client = get_ssh_client()

                # 맵 이름으로 시작하는 최신 디렉토리 찾기
                find_cmd = f"sudo ls -dt {NOS_MAP_BASE_DIR}/{map_name}-*/ 2>/dev/null | head -1"
                map_dir = ssh_exec(client, find_cmd).rstrip("/")

                if not map_dir:
                    raise HTTPException(status_code=404, detail=f"로봇에서 맵 디렉토리를 찾을 수 없습니다: {map_name}-*")

                # active 심볼릭 링크 교체
                activate_cmd = f"sudo rm -f {NOS_MAP_BASE_DIR}/active && sudo ln -s {map_dir} {NOS_MAP_BASE_DIR}/active"
                ssh_exec(client, activate_cmd)

                # localization 서비스 재시작 (새 맵 로드)
                ssh_exec(client, "sudo systemctl restart localization")
                print(f"🗺️ 활성 맵 변경: {map_name} → {map_dir} (localization 재시작)")

                activate_success = True
                break
            except HTTPException:
                raise
            except Exception as e:
                print(f"[SSH] 맵 활성화 실패 ({attempt+1}/3): {e}")
                if client:
                    try: client.close()
                    except: pass
                    client = None
                if attempt < 2:
                    time.sleep(3)

        if not activate_success:
            raise Exception("SSH 연결 불안정으로 맵 활성화 실패")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"맵 활성화 실패: {str(e)}")
    finally:
        if client:
            try: client.close()
            except: pass

    # CurrentFloorId, CurrentMapId 업데이트
    robot.CurrentFloorId = m.FloorId
    robot.CurrentMapId = m.id
    db.commit()

    # 런타임에도 반영
    runtime.update_floor(req.robot_id, m.FloorId, m.id)

    # 맵+로봇 초기 위치가 저장되어 있으면 init_pose 전송
    init_pose_sent = False
    init_pose_row = db.query(MapInitPose).filter(
        MapInitPose.MapId == req.map_id,
        MapInitPose.RobotId == req.robot_id,
    ).first()
    if init_pose_row:
        # localization 재시작 후 안정화 대기
        time.sleep(5)
        init_items = {"PosX": init_pose_row.PosX, "PosY": init_pose_row.PosY, "PosZ": 0.0, "Yaw": init_pose_row.Yaw}
        _send_init_pose(robot.RobotIP, robot.RobotPort or 30000, init_items)
        init_pose_sent = True

    write_audit(db, current_user.id, "map_activated", "map", m.id,
                detail=f"활성 맵 변경: {map_name} (로봇: {robot.RobotName})",
                ip_address=get_client_ip(request))

    return {
        "status": "ok",
        "msg": f"활성 맵이 '{map_name}'(으)로 변경되었습니다.",
        "map_name": map_name,
        "floor_id": m.FloorId,
        "init_pose_sent": init_pose_sent,
    }


# =========================
# 맵 동기화 (A 로봇 맵 → B 로봇에 전송·활성화)
# =========================
@router.post("/maps/sync")
def sync_map(req: SyncMapReq, request: Request, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
    """
    선택한 맵의 zip을 대상 로봇에 업로드 → 압축 해제 → symlink 교체 → localization 재시작
    """
    from app.database.models import RobotInfo
    from app.map.mapping_control import get_ssh_client, ssh_exec, NOS_MAP_BASE_DIR, BASE_DIR
    import app.robot_io.runtime as runtime

    # 맵 조회
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == req.map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="맵을 찾을 수 없습니다.")
    if not m.ZipFilePath:
        raise HTTPException(status_code=400, detail="이 맵에는 동기화용 zip 파일이 없습니다.")

    # zip 파일 존재 확인
    local_zip = os.path.join(BASE_DIR, m.ZipFilePath.replace("./", ""))
    if not os.path.exists(local_zip):
        raise HTTPException(status_code=404, detail=f"zip 파일을 찾을 수 없습니다: {m.ZipFilePath}")

    # 로봇 조회
    robot = db.query(RobotInfo).filter(RobotInfo.id == req.robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="로봇을 찾을 수 없습니다.")

    zip_filename = os.path.basename(local_zip)
    # zip 파일명에서 맵 디렉토리명 추출 (예: MapName-20260410.zip → MapName-20260410)
    dir_name = zip_filename.rsplit(".zip", 1)[0]

    client = None
    try:
        sync_success = False
        for attempt in range(3):
            try:
                client = get_ssh_client()

                # 1. SFTP로 zip 업로드
                remote_zip = f"{NOS_MAP_BASE_DIR}/{zip_filename}"
                sftp = client.open_sftp()
                print(f"📤 SFTP 업로드: {local_zip} → {remote_zip}")
                sftp.put(local_zip, remote_zip)
                sftp.close()

                # 2. 로봇에서 zip 압축 해제
                unzip_cmd = f"cd {NOS_MAP_BASE_DIR} && sudo unzip -o {zip_filename}"
                ssh_exec(client, unzip_cmd, exec_timeout=120)
                print(f"📦 로봇에서 압축 해제 완료: {dir_name}")

                # 3. 업로드한 zip 파일 정리
                ssh_exec(client, f"sudo rm -f {remote_zip}")

                # 4. active 심볼릭 링크 교체
                map_dir = f"{NOS_MAP_BASE_DIR}/{dir_name}"
                activate_cmd = f"sudo rm -f {NOS_MAP_BASE_DIR}/active && sudo ln -s {map_dir} {NOS_MAP_BASE_DIR}/active"
                ssh_exec(client, activate_cmd)

                # 5. localization 서비스 재시작
                ssh_exec(client, "sudo systemctl restart localization")
                print(f"🗺️ 맵 동기화 완료: {m.MapName} → 로봇 {robot.RobotName} (localization 재시작)")

                sync_success = True
                break
            except HTTPException:
                raise
            except Exception as e:
                print(f"[SSH] 맵 동기화 실패 ({attempt+1}/3): {e}")
                if client:
                    try: client.close()
                    except: pass
                    client = None
                if attempt < 2:
                    time.sleep(3)

        if not sync_success:
            raise Exception("SSH 연결 불안정으로 맵 동기화 실패")

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERR] 맵 동기화 실패: {e}")
        raise HTTPException(status_code=500, detail=f"맵 동기화 실패: {str(e)}")
    finally:
        if client:
            try: client.close()
            except: pass

    # CurrentFloorId, CurrentMapId 업데이트
    robot.CurrentFloorId = m.FloorId
    robot.CurrentMapId = m.id
    db.commit()

    # 런타임에도 반영
    runtime.update_floor(req.robot_id, m.FloorId, m.id)

    # init_pose 전송
    init_pose_sent = False
    init_pose_row = db.query(MapInitPose).filter(
        MapInitPose.MapId == req.map_id,
        MapInitPose.RobotId == req.robot_id,
    ).first()
    if init_pose_row:
        time.sleep(5)
        init_items = {"PosX": init_pose_row.PosX, "PosY": init_pose_row.PosY, "PosZ": 0.0, "Yaw": init_pose_row.Yaw}
        _send_init_pose(robot.RobotIP, robot.RobotPort or 30000, init_items)
        init_pose_sent = True

    write_audit(db, current_user.id, "map_synced", "map", m.id,
                detail=f"맵 동기화: {m.MapName} → 로봇 {robot.RobotName}",
                ip_address=get_client_ip(request))

    return {
        "status": "ok",
        "msg": f"맵 '{m.MapName}'이(가) 로봇 '{robot.RobotName}'에 동기화되었습니다.",
        "map_name": m.MapName,
        "floor_id": m.FloorId,
        "init_pose_sent": init_pose_sent,
    }


# =========================
# 내부 헬퍼
# =========================
def _send_init_pose(robot_ip: str, robot_port: int, items: dict):
    """로봇에 init_pose(Type 2101) UDP 패킷 전송."""
    asdu = {
        "PatrolDevice": {
            "Type": 2101,
            "Command": 1,
            "Time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "Items": items,
        }
    }
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.sendto(build_packet(asdu), (robot_ip, robot_port))
    sock.close()
    print(f"🚀 [INIT_POSE] 전송: {robot_ip}:{robot_port} | {items}")
