"""
맵핑 제어 API
─────────────
[Frontend 버튼] → [FastAPI API] → [SSH to NOS(106)] → bash 명령 실행
                                                          ↓
 [DB에 경로 저장] ← [static/maps에 저장] ← [SCP로 파일 가져오기]
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.Database.database import SessionLocal
from app.Database.models import RobotMapInfo, UserInfo
from app.auth.dependencies import get_current_user

import paramiko
import os
import shutil
import threading
import time

mapping_ctrl = APIRouter(prefix="/map/mapping")

# ── NOS SSH 설정 ──
NOS_HOST = "10.21.31.106"
NOS_PORT = 22
NOS_USER = "user"          # TODO: 실제 유저명 확인
NOS_PASSWORD = "'"   # TODO: 실제 비밀번호 확인

# ── NOS 상의 매핑 관련 경로 ──
NOS_MAP_BASE_DIR = "/var/opt/robot/data/maps"
NOS_PGM_FILENAME = "occ_grid.pgm"
NOS_YAML_FILENAME = "occ_grid.yaml"

# ── 로컬 저장 경로 ──
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOCAL_MAPS_DIR = os.path.join(BASE_DIR, "static", "maps")

# ── 매핑 상태 (SSH 클라이언트는 저장하지 않음 — 매번 새로 연결) ──
mapping_state = {
    "is_running": False,
    "area_name": None,
    "business_id": None,
    "area_id": None,
}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_ssh_client(retries=10):
    """NOS에 SSH 연결 (불안정 네트워크 대비 — 최대 10회 재시도)"""
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=NOS_HOST,
                port=NOS_PORT,
                username=NOS_USER,
                password=NOS_PASSWORD,
                timeout=5,
                banner_timeout=5,
                auth_timeout=5,
                allow_agent=False,
                look_for_keys=False,
            )
            if attempt > 1:
                print(f"[SSH] {attempt}번째 시도에서 연결 성공")
            return client
        except Exception as e:
            last_error = e
            print(f"[SSH] 연결 실패 ({attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(3)
    raise last_error


def ssh_exec(client: paramiko.SSHClient, command: str, exec_timeout=60) -> str:
    """SSH 명령 실행 후 stdout 반환 (sudo 비밀번호 자동 입력)"""
    stdin, stdout, stderr = client.exec_command(command, get_pty=True, timeout=exec_timeout)
    if command.strip().startswith("sudo") or "sudo " in command:
        time.sleep(0.5)
        stdin.write(NOS_PASSWORD + "\n")
        stdin.flush()
    output = stdout.read().decode("utf-8").strip()
    error = stderr.read().decode("utf-8").strip()
    if error:
        print(f"[SSH STDERR] {error}")
    # sudo 프롬프트/패스워드 에코 제거
    lines = output.split("\n")
    cleaned = [l for l in lines if not l.startswith("[sudo]") and l != NOS_PASSWORD]
    return "\n".join(cleaned).strip()


# ══════════════════════════════════════
# 매핑 시작
# ══════════════════════════════════════
class MappingStartReq(BaseModel):
    BusinessId: int
    AreaId: int
    AreaName: str


@mapping_ctrl.post("/start")
def mapping_start(req: MappingStartReq, current_user: UserInfo = Depends(get_current_user)):
    if mapping_state["is_running"]:
        raise HTTPException(status_code=409, detail="이미 매핑이 진행 중입니다.")

    client = None
    try:
        # 1. drmap mapping 실행 (SSH 실패 시 재접속하여 재시도)
        command = f"sudo drmap mapping -n {req.AreaName}"
        start_success = False
        for attempt in range(3):
            try:
                client = get_ssh_client()
                ssh_exec(client, command)
                start_success = True
                break
            except Exception as e:
                print(f"[SSH] mapping start 실패 ({attempt+1}/3): {e}")
                if client:
                    try: client.close()
                    except: pass
                    client = None
                time.sleep(3)

        if not start_success:
            raise Exception("SSH 연결 불안정으로 매핑 시작 명령 실행 실패")

        mapping_state["is_running"] = True
        mapping_state["area_name"] = req.AreaName
        mapping_state["business_id"] = req.BusinessId
        mapping_state["area_id"] = req.AreaId

        print(f"🗺️ 매핑 시작: {req.AreaName}")
        return {"status": "ok", "message": "매핑이 시작되었습니다."}

    except Exception as e:
        print(f"[ERR] 매핑 시작 실패: {e}")
        raise HTTPException(status_code=500, detail=f"매핑 시작 실패: {str(e)}")
    finally:
        if client:
            try: client.close()
            except: pass




# ══════════════════════════════════════
# 매핑 종료 → 파일 가져오기 → DB 저장
# ══════════════════════════════════════
class MappingEndReq(BaseModel):
    BusinessId: int
    AreaId: int
    AreaName: str


@mapping_ctrl.post("/end")
def mapping_end(req: MappingEndReq, db: Session = Depends(get_db), current_user: UserInfo = Depends(get_current_user)):
    client = None

    try:
        # 1. 매핑 종료 명령 (SSH 실패 시 재접속하여 재시도)
        stop_success = False
        for attempt in range(3):
            try:
                client = get_ssh_client()
                ssh_exec(client, "sudo drmap stop_mapping")
                print("🛑 drmap stop_mapping 실행")
                stop_success = True
                break
            except Exception as e:
                print(f"[SSH] stop_mapping 실패 ({attempt+1}/3): {e}")
                if client:
                    try: client.close()
                    except: pass
                    client = None
                time.sleep(3)

        if not stop_success:
            raise Exception("SSH 연결 불안정으로 매핑 종료 명령 실행 실패")

        # 2. 맵 디렉토리 생성 대기 (최대 60초, SSH 끊기면 재접속)
        map_dir = ""
        find_cmd = f"sudo ls -dt {NOS_MAP_BASE_DIR}/{req.AreaName}-*/ 2>/dev/null | head -1"

        for wait in range(20):
            time.sleep(3)
            try:
                map_dir = ssh_exec(client, find_cmd).rstrip("/")
            except Exception:
                print(f"[SSH] 연결 끊김, 재접속 시도...")
                try: client.close()
                except: pass
                client = get_ssh_client()
                map_dir = ssh_exec(client, find_cmd).rstrip("/")
            if map_dir:
                break
            print(f"⏳ 맵 생성 대기 중... ({(wait+1)*3}초)")

        if not map_dir:
            raise Exception(f"맵 디렉토리를 찾을 수 없습니다: {NOS_MAP_BASE_DIR}/{req.AreaName}-*")

        print(f"📂 맵 디렉토리 발견: {map_dir}")

        # 3. SFTP로 파일 가져오기
        sftp = client.open_sftp()
        os.makedirs(LOCAL_MAPS_DIR, exist_ok=True)

        remote_pgm = f"{map_dir}/{NOS_PGM_FILENAME}"
        remote_yaml = f"{map_dir}/{NOS_YAML_FILENAME}"

        local_pgm = os.path.join(LOCAL_MAPS_DIR, f"{req.AreaName}.pgm")
        local_yaml = os.path.join(LOCAL_MAPS_DIR, f"{req.AreaName}.yaml")

        print(f"📥 SFTP 다운로드: {remote_pgm} → {local_pgm}")
        sftp.get(remote_pgm, local_pgm)

        print(f"📥 SFTP 다운로드: {remote_yaml} → {local_yaml}")
        sftp.get(remote_yaml, local_yaml)

        sftp.close()

        # 4. PGM → PNG 변환
        import cv2
        local_png = os.path.join(LOCAL_MAPS_DIR, f"{req.AreaName}.png")
        img = cv2.imread(local_pgm, cv2.IMREAD_GRAYSCALE)
        if img is not None:
            cv2.imwrite(local_png, img)
            print(f"🖼️ PGM → PNG 변환 완료: {local_png}")
        else:
            print(f"⚠️ PGM 읽기 실패, PNG 변환 건너뜀")

        # 5. SSH 연결 종료
        client.close()
        client = None

        # 7. DB에 맵 정보 저장
        pgm_path = f"./static/maps/{req.AreaName}.pgm"
        yaml_path = f"./static/maps/{req.AreaName}.yaml"
        img_path = f"./static/maps/{req.AreaName}.png"

        robot_map = RobotMapInfo(
            BusinessId=req.BusinessId,
            AreaId=req.AreaId,
            AreaName=req.AreaName,
            PgmFilePath=pgm_path,
            YamlFilePath=yaml_path,
            ImgFilePath=img_path,
        )
        db.add(robot_map)
        db.commit()
        db.refresh(robot_map)

        # 8. 상태 초기화
        mapping_state["is_running"] = False
        mapping_state["area_name"] = None
        mapping_state["business_id"] = None
        mapping_state["area_id"] = None

        print(f"✅ 매핑 완료 & 저장: {req.AreaName}")
        return {
            "status": "ok",
            "message": "매핑이 완료되고 저장되었습니다.",
            "map_id": robot_map.id,
        }

    except Exception as e:
        print(f"[ERR] 매핑 종료 실패: {e}")
        mapping_state["is_running"] = False
        raise HTTPException(status_code=500, detail=f"매핑 종료 실패: {str(e)}")
    finally:
        if client:
            try: client.close()
            except: pass


# ══════════════════════════════════════
# 매핑 취소 (저장 없이 종료)
# ══════════════════════════════════════
@mapping_ctrl.post("/cancel")
def mapping_cancel(current_user: UserInfo = Depends(get_current_user)):
    area_name = mapping_state.get("area_name")
    client = None

    try:
        client = get_ssh_client()
        ssh_exec(client, "sudo drmap stop_mapping")

        if area_name:
            time.sleep(2)
            ssh_exec(client, f"sudo rm -rf {NOS_MAP_BASE_DIR}/{area_name}-*/")
            print(f"🗑️ 맵 디렉토리 삭제: {area_name}-*/")
    except Exception as e:
        print(f"[ERR] 매핑 취소 중 오류: {e}")
    finally:
        if client:
            try: client.close()
            except: pass
        mapping_state["is_running"] = False
        mapping_state["area_name"] = None
        mapping_state["business_id"] = None
        mapping_state["area_id"] = None

    print("🚫 매핑 취소됨")
    return {"status": "ok", "message": "매핑이 취소되었습니다."}


# ══════════════════════════════════════
# 매핑 상태 조회
# ══════════════════════════════════════
@mapping_ctrl.get("/status")
def mapping_status(current_user: UserInfo = Depends(get_current_user)):
    return {
        "is_running": mapping_state["is_running"],
        "area_name": mapping_state["area_name"],
    }
