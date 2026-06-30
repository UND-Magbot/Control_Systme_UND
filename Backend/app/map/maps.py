from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import json
import os
import re
import time
import socket

from app.robot_io.protocol import build_packet
from app.database.database import get_db
from app.database.models import (
    RobotMapInfo, UserInfo, LocationInfo, RouteInfo, WayInfo, MapInitPose,
)
from app.auth.dependencies import get_current_user, require_permission, is_admin
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


class ImportMapReq(BaseModel):
    robot_id: int
    dir: str           # 로봇(NOS) 맵 디렉토리명 (예: test_gumi06-20260618-130620)
    MapName: str       # 관제에 저장될 맵 이름
    FloorId: int
    BusinessId: int


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
    elif not is_admin(current_user) and current_user.BusinessId:
        q = q.filter(RobotMapInfo.BusinessId == current_user.BusinessId)
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

    # 다른 관제 PC 라 로컬에 파일이 없으면 공유 DB 에서 복원(yaml+png+pgm).
    # png/pgm 까지 함께 복원해두면 이어지는 정적 이미지 요청도 곧바로 성공한다.
    try:
        from app.map.map_file_store import ensure_local
        ensure_local(db, m)
    except Exception as e:
        print(f"[MAPFILE] 메타 조회 중 복원 실패 map={map_id}: {e}")

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


@router.get("/maps/{map_id}/files")
def get_map_file_status(
    map_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
):
    """맵 파일이 로컬·공유 DB 에 있는지, 해시가 일치하는지 검증 정보를 반환한다."""
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    from app.map.map_file_store import file_status
    return {"map_id": map_id, "map_name": m.MapName, "files": file_status(db, m)}


@router.post("/maps/{map_id}/files/upload")
def upload_map_files_to_db(
    map_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("map-edit")),
):
    """현재 PC 로컬의 맵 파일을 공유 DB 로 올린다(백필·복구용)."""
    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    from app.map.map_file_store import store_map_files
    result = store_map_files(db, m)
    return {"map_id": map_id, "stored": result}


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

    # 공유 DB 에 저장된 맵 실물 파일 BLOB 정리
    from app.database.models import RobotMapFile
    db.query(RobotMapFile).filter(RobotMapFile.MapId == map_id).delete(synchronize_session=False)

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
    from app.map.mapping_control import get_ssh_client, ssh_exec, NOS_MAP_BASE_DIR, nos_host_for_robot_ip
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
    # 로봇 디렉토리명은 ZipFilePath(항상 로봇 dir 기반: ./static/maps/{robot_dir}.zip)에서 복원.
    # → 사용자가 가져오기에서 MapName을 바꿔도 로봇 dir를 정확히 찾을 수 있다.
    zip_dir = ""
    if m.ZipFilePath:
        zip_dir = os.path.basename(m.ZipFilePath).rsplit(".zip", 1)[0]
    # 로봇별 NOS — 로봇 IP 기준(.106). 유효하지 않으면 env 기본 NOS 사용.
    try:
        nos_host = nos_host_for_robot_ip(robot.RobotIP)
    except ValueError:
        nos_host = None
    client = None
    try:
        # SSH 실패 시 재접속하여 재시도 (최대 3회)
        activate_success = False
        map_dir = ""
        for attempt in range(3):
            try:
                client = get_ssh_client(host=nos_host)

                # 로봇 디렉토리 탐색 순서:
                #   1) zip 기준 robot dir 정확 일치 (가져오기·매핑 공통, 이름 변경에도 안전)
                #   2) MapName 정확 일치 (구버전/직접 지정)
                #   3) {MapName}-* 글롭 (매핑 베이스 이름 호환)
                candidates = []
                if zip_dir:
                    candidates.append(f"ls -d {NOS_MAP_BASE_DIR}/{zip_dir} 2>/dev/null")
                candidates.append(f"ls -d {NOS_MAP_BASE_DIR}/{map_name} 2>/dev/null")
                candidates.append(f"ls -dt {NOS_MAP_BASE_DIR}/{map_name}-*/ 2>/dev/null | head -1")
                find_cmd = "sudo bash -c '" + " || ".join(candidates) + "'"
                map_dir = ssh_exec(client, find_cmd).rstrip("/")

                if not map_dir:
                    raise HTTPException(status_code=404, detail=f"로봇에서 맵 디렉토리를 찾을 수 없습니다: {map_name}")

                # 미완성 맵(매핑 중단 등 — full_cloud.pcd 없음)은 active 로 걸지 않는다(측위 발산 방지).
                from app.map.mapping_control import map_dir_is_complete
                if not map_dir_is_complete(client, map_dir):
                    raise HTTPException(
                        status_code=409,
                        detail=f"맵 데이터가 불완전합니다(full_cloud.pcd 없음): {map_name}. 매핑을 다시 완료한 뒤 활성화하세요.",
                    )

                # active 심볼릭 링크 교체 (robust).
                #   rm -rf(후행 슬래시 없음 → 심볼릭이면 링크만, 실제 디렉토리 잔재면 통째로 제거)
                #   + ln -sfn(-n: active 가 심볼릭→디렉토리여도 따라가 중첩 생성하지 않고 교체).
                #   ⚠️ rm 과 ln 사이에 다른 프로세스(drmap/localization)가 active 를 실제
                #   디렉토리로 재생성하면, ln 이 그 디렉토리 안에 중첩 링크를 만들고 성공(exit 0)해
                #   active 가 심볼릭이 아닌 일반 디렉토리로 깨진다(층 변경 중 active 유실).
                #   → 교체 직후 test -L 로 심볼릭 여부를 검증하고, 아니면 예외를 던져
                #   재시도 루프로 자가복구한다.
                activate_cmd = (
                    f"sudo rm -rf {NOS_MAP_BASE_DIR}/active && "
                    f"sudo ln -sfn {map_dir} {NOS_MAP_BASE_DIR}/active"
                )
                ssh_exec(client, activate_cmd)
                is_link = ssh_exec(
                    client, f"test -L {NOS_MAP_BASE_DIR}/active && echo OK || echo NO"
                ).strip().endswith("OK")
                if not is_link:
                    raise Exception(
                        f"active 재링크 후에도 심볼릭이 아님(디렉토리로 깨짐) — 재시도: {NOS_MAP_BASE_DIR}/active"
                    )

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
    선택한 맵의 zip을 대상 로봇에 업로드 → 압축 해제 → symlink 교체 → localization 재시작.

    진행 상황은 NDJSON 스트림으로 전송한다.
      - {"event":"retry","attempt":N}
      - {"event":"step","step":N,"total":3,"msg":"..."}
      - {"event":"done","status":"ok"|"error","msg":"...","map_name":...}
    """
    from app.database.models import RobotInfo
    from app.map.mapping_control import get_ssh_client, ssh_exec, NOS_MAP_BASE_DIR, BASE_DIR
    import app.robot_io.runtime as runtime

    m = db.query(RobotMapInfo).filter(RobotMapInfo.id == req.map_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="맵을 찾을 수 없습니다.")
    if not m.ZipFilePath:
        raise HTTPException(status_code=400, detail="이 맵에는 동기화용 zip 파일이 없습니다.")

    local_zip = os.path.join(BASE_DIR, m.ZipFilePath.replace("./", ""))
    if not os.path.exists(local_zip):
        # 다른 관제 PC 라 로컬에 zip 이 없으면 공유 DB 에서 복원.
        try:
            from app.map.map_file_store import restore_file
            restore_file(db, m, "zip")
        except Exception as e:
            print(f"[MAPFILE] 동기화용 zip 복원 실패 map={m.id}: {e}")
    if not os.path.exists(local_zip):
        raise HTTPException(status_code=404, detail=f"zip 파일을 찾을 수 없습니다: {m.ZipFilePath}")

    robot = db.query(RobotInfo).filter(RobotInfo.id == req.robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="로봇을 찾을 수 없습니다.")

    zip_filename = os.path.basename(local_zip)
    dir_name = zip_filename.rsplit(".zip", 1)[0]
    ip_addr = get_client_ip(request)
    user_id = current_user.id

    def _evt(**kwargs) -> bytes:
        return (json.dumps(kwargs, ensure_ascii=False) + "\n").encode("utf-8")

    def event_stream():
        client = None
        sync_success = False
        last_error: Optional[str] = None

        try:
            for attempt in range(3):
                try:
                    if attempt > 0:
                        yield _evt(event="retry", attempt=attempt + 1)
                    client = get_ssh_client()

                    # 1/3 — SFTP 업로드
                    yield _evt(event="step", step=1, total=3, msg="맵 파일 전송 중")
                    remote_zip = f"{NOS_MAP_BASE_DIR}/{zip_filename}"
                    sftp = client.open_sftp()
                    print(f"📤 SFTP 업로드: {local_zip} → {remote_zip}")
                    sftp.put(local_zip, remote_zip)
                    sftp.close()

                    # 2/3 — 압축 해제 + 정리 + active 심볼릭 링크
                    unzip_cmd = f"cd {NOS_MAP_BASE_DIR} && sudo unzip -o {zip_filename}"
                    ssh_exec(client, unzip_cmd, exec_timeout=120)
                    print(f"📦 로봇에서 압축 해제 완료: {dir_name}")
                    ssh_exec(client, f"sudo rm -f {remote_zip}")
                    map_dir = f"{NOS_MAP_BASE_DIR}/{dir_name}"
                    # 미완성 맵은 active 로 걸지 않는다(측위 발산 방지).
                    from app.map.mapping_control import map_dir_is_complete
                    if not map_dir_is_complete(client, map_dir):
                        raise Exception(f"동기화된 맵이 불완전합니다(full_cloud.pcd 없음): {dir_name}")
                    # rm -rf: active 가 실제 디렉토리로 깨져 있어도 안전히 교체(심볼릭이면 링크만 제거).
                    activate_cmd = f"sudo rm -rf {NOS_MAP_BASE_DIR}/active && sudo ln -s {map_dir} {NOS_MAP_BASE_DIR}/active"
                    ssh_exec(client, activate_cmd)
                    yield _evt(event="step", step=2, total=3, msg="맵 파일 활성화 완료")

                    # 3/3 — localization 재시작
                    yield _evt(event="step", step=3, total=3, msg="로봇이 새 맵에 적응하는 중")
                    ssh_exec(client, "sudo systemctl restart localization")
                    print(f"🗺️ 맵 동기화 완료: {m.MapName} → 로봇 {robot.RobotName} (localization 재시작)")

                    sync_success = True
                    break
                except Exception as e:
                    last_error = str(e)
                    print(f"[SSH] 맵 동기화 실패 ({attempt+1}/3): {e}")
                    if client:
                        try: client.close()
                        except: pass
                        client = None
                    if attempt < 2:
                        time.sleep(3)

            if not sync_success:
                yield _evt(event="done", status="error",
                           msg=f"맵 동기화 실패: {last_error or 'SSH 연결 불안정'}")
                return

            robot.CurrentFloorId = m.FloorId
            robot.CurrentMapId = m.id
            db.commit()
            runtime.update_floor(req.robot_id, m.FloorId, m.id)

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

            write_audit(db, user_id, "map_synced", "map", m.id,
                        detail=f"맵 동기화: {m.MapName} → 로봇 {robot.RobotName}",
                        ip_address=ip_addr)

            yield _evt(
                event="done",
                status="ok",
                msg=f"맵 '{m.MapName}'이(가) 로봇 '{robot.RobotName}'에 동기화되었습니다.",
                map_name=m.MapName,
                floor_id=m.FloorId,
                init_pose_sent=init_pose_sent,
            )
        except Exception as e:
            print(f"[ERR] 맵 동기화 실패: {e}")
            yield _evt(event="done", status="error", msg=f"맵 동기화 실패: {str(e)}")
        finally:
            if client:
                try: client.close()
                except: pass

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


# =========================
# 로봇 내부 맵 가져오기 (Import) — 로봇엔 있으나 관제에 없는 맵 복구
# =========================
@router.get("/robot-maps")
def list_robot_maps_api(robot_id: int, request: Request, db: Session = Depends(get_db),
                        current_user: UserInfo = Depends(require_permission("map-edit"))):
    """선택한 로봇(NOS)에 저장된 맵 목록을 조회한다.

    각 항목에 관제 DB 기준 already_imported(동일 MapName 존재) 플래그를 덧붙인다.
    """
    from app.database.models import RobotInfo
    from app.map.mapping_control import get_ssh_client, list_robot_maps, nos_host_for_robot_ip

    robot = db.query(RobotInfo).filter(RobotInfo.id == robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="로봇을 찾을 수 없습니다.")

    # 로봇별 NOS — 로봇 IP 기준으로 맵 서버(.106) 유도
    try:
        nos_host = nos_host_for_robot_ip(robot.RobotIP)
    except ValueError:
        raise HTTPException(status_code=400, detail="로봇 IP가 유효하지 않아 맵 서버에 접속할 수 없습니다.")

    client = None
    try:
        client = get_ssh_client(retries=3, host=nos_host)
        maps = list_robot_maps(client)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"로봇 맵 목록 조회 실패({nos_host}): {str(e)}")
    finally:
        if client:
            try: client.close()
            except: pass

    # 관제 DB에 이미 등록된 맵 이름 집합 (사업장 범위)
    q = db.query(RobotMapInfo.MapName)
    if robot.BusinessId:
        q = q.filter(RobotMapInfo.BusinessId == robot.BusinessId)
    existing = {row[0] for row in q.all()}
    for m in maps:
        # 가져오기 시 dir(날짜 포함) 이름으로 저장하므로 dir 우선, 구버전 호환 위해 name 도 확인
        m["already_imported"] = (m["dir"] in existing) or (m["name"] in existing)

    return maps


@router.post("/maps/import")
def import_map(req: ImportMapReq, request: Request, db: Session = Depends(get_db),
               current_user: UserInfo = Depends(require_permission("map-edit"))):
    """로봇(NOS)의 맵 디렉토리를 관제로 다운로드 + DB 등록한다.

    동기화(active 전파)는 하지 않는다 — 별도 /maps/sync 버튼 책임.
    """
    from app.database.models import RobotInfo
    from app.map.mapping_control import (
        get_ssh_client, ssh_exec, download_robot_map, nos_host_for_robot_ip,
        NOS_MAP_BASE_DIR, NOS_PGM_FILENAME, NOS_YAML_FILENAME,
    )

    robot = db.query(RobotInfo).filter(RobotInfo.id == req.robot_id).first()
    if not robot:
        raise HTTPException(status_code=404, detail="로봇을 찾을 수 없습니다.")

    # 로봇별 NOS — 로봇 IP 기준으로 맵 서버(.106) 유도
    try:
        nos_host = nos_host_for_robot_ip(robot.RobotIP)
    except ValueError:
        raise HTTPException(status_code=400, detail="로봇 IP가 유효하지 않아 맵 서버에 접속할 수 없습니다.")

    # 디렉토리명 안전성 검증 (경로 주입 방지)
    if "/" in req.dir or ".." in req.dir or not req.dir.strip():
        raise HTTPException(status_code=400, detail="잘못된 맵 디렉토리명입니다.")

    # 중복 이름 차단 (사업장 범위) — 사용자가 이름을 바꿔 재시도
    dup = db.query(RobotMapInfo).filter(
        RobotMapInfo.MapName == req.MapName,
        RobotMapInfo.BusinessId == req.BusinessId,
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"이미 '{req.MapName}' 이름의 맵이 있습니다. 다른 이름으로 가져오세요.")

    map_dir = f"{NOS_MAP_BASE_DIR}/{req.dir}"
    client = None
    try:
        client = get_ssh_client(retries=3, host=nos_host)
        # 완료 맵 검증 (pgm+yaml 존재)
        check = ssh_exec(
            client,
            f"sudo bash -c '[ -e \"{map_dir}/{NOS_PGM_FILENAME}\" ] && [ -e \"{map_dir}/{NOS_YAML_FILENAME}\" ] && echo OK || echo NO'",
            exec_timeout=20,
        )
        if "OK" not in check:
            raise HTTPException(status_code=404, detail="로봇에서 완료된 맵 디렉토리를 찾을 수 없습니다(미완결 맵).")

        paths = download_robot_map(client, map_dir, req.MapName)
    except HTTPException:
        raise
    except Exception as e:
        # 부분 다운로드 정리
        _cleanup_local_map(req.MapName)
        raise HTTPException(status_code=502, detail=f"맵 가져오기 실패: {str(e)}")
    finally:
        if client:
            try: client.close()
            except: pass

    robot_map = RobotMapInfo(
        BusinessId=req.BusinessId,
        FloorId=req.FloorId,
        MapName=req.MapName,
        PgmFilePath=paths["pgm"],
        YamlFilePath=paths["yaml"],
        ImgFilePath=paths["img"],
        ZipFilePath=paths["zip"],
    )
    db.add(robot_map)
    db.commit()
    db.refresh(robot_map)

    # 맵 실물 파일을 공유 DB 로 업로드 (다른 관제 PC 가 파일 없이도 사용 가능)
    try:
        from app.map.map_file_store import store_map_files
        store_map_files(db, robot_map)
    except Exception as e:
        print(f"[MAPFILE] 가져오기 후 DB 업로드 실패(맵 등록은 정상): {e}")

    write_audit(db, current_user.id, "map_imported", "map", robot_map.id,
                detail=f"로봇 맵 가져오기: {req.MapName} (로봇: {robot.RobotName}, dir: {req.dir})",
                ip_address=get_client_ip(request))

    return {"status": "ok", "map_id": robot_map.id, "map_name": req.MapName, "floor_id": req.FloorId}


def _cleanup_local_map(map_name: str) -> None:
    """가져오기 실패 시 부분 다운로드된 로컬 파일을 정리한다."""
    base = os.path.join(".", "static", "maps")
    for ext in ("pgm", "yaml", "png"):
        p = os.path.join(base, f"{map_name}.{ext}")
        try:
            if os.path.exists(p):
                os.remove(p)
        except Exception:
            pass


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
