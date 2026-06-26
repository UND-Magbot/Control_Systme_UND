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

from app.database.database import get_db
from app.database.models import RobotMapInfo, UserInfo
from app.auth.dependencies import require_permission

from dotenv import load_dotenv
import paramiko
import os
import time

# 로컬(비 docker) 실행 시 .env 로드 — docker 에서는 compose environment 로 주입됨.
# 루트(.env) 와 Backend/.env 둘 다 시도하여 어디에 두든 동작하게 한다.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(_BACKEND_ROOT, ".env"))
load_dotenv(os.path.join(os.path.dirname(_BACKEND_ROOT), ".env"))

mapping_ctrl = APIRouter(prefix="/map/mapping")

# ── NOS SSH 설정 (환경변수로 분리 — .env / docker-compose 에서 주입) ──
NOS_HOST = os.getenv("NOS_HOST", "10.21.31.106")
NOS_PORT = int(os.getenv("NOS_PORT", "22"))
NOS_USER = os.getenv("NOS_USER", "")
NOS_PASSWORD = os.getenv("NOS_PASSWORD", "")

if not NOS_USER or not NOS_PASSWORD:
    print("[WARN] NOS_USER/NOS_PASSWORD 환경변수가 비어 있습니다. "
          "매핑 SSH(시작/종료/취소)가 인증 실패할 수 있습니다. .env 를 확인하세요.")

# ── NOS 상의 매핑 관련 경로 ──
NOS_MAP_BASE_DIR = "/var/opt/robot/data/maps"
NOS_PGM_FILENAME = "occ_grid.pgm"
NOS_YAML_FILENAME = "occ_grid.yaml"

# ── relay_map.py(실시간 매핑 시각화 릴레이) 자동 기동 설정 ──
# 매핑 시작 시 로봇에서 relay_map.py 를 자동 기동한다(미실행 시). 종료/취소 시 정리한다.
# relay 가 떠 있어야 ROS2 SLAM 토픽 → UDP(50000) → receiver.py(40000) → 백엔드 WS →
# 브라우저 캔버스로 실시간 점군/odom 이 그려진다. 경로는 .env/docker-compose 에서 덮어쓴다.
NOS_RELAY_SCRIPT = os.getenv("NOS_RELAY_SCRIPT", "/home/user/Control_system/relay_map.py")
NOS_ROS2_SETUP = os.getenv("NOS_ROS2_SETUP", "/opt/robot/scripts/setup_ros2.sh")
NOS_RELAY_LOG = os.getenv("NOS_RELAY_LOG", "/tmp/relay_map.log")

# ── 로컬 저장 경로 ──
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LOCAL_MAPS_DIR = os.path.join(BASE_DIR, "static", "maps")

# ── 매핑 상태 (SSH 클라이언트는 저장하지 않음 — 매번 새로 연결) ──
# prev_active: 매핑 시작 직전의 active 심볼릭 링크 대상(이전 정상 맵).
#   drmap mapping 은 새 맵 디렉토리를 만들고 active 를 거기로 물리므로,
#   종료(/end)하지 않고 취소·새로고침으로 중단되면 active 가 미완결 맵에 고착된다.
#   → 중단 시 이 값으로 active 를 복원(초기화)하기 위해 시작 시 스냅샷해 둔다.
mapping_state = {
    "is_running": False,
    "map_name": None,
    "business_id": None,
    "floor_id": None,
    "prev_active": None,
}


# 로봇별 NOS는 로봇 IP와 같은 /24 대역의 이 호스트 옥텟에 있다(기본 .106).
NOS_HOST_OCTET = os.getenv("NOS_HOST_OCTET", "106")


def nos_host_for_robot_ip(robot_ip: str) -> str:
    """로봇 IP 기준으로 그 로봇의 NOS(맵 서버) 호스트를 유도한다.

    예: 10.21.31.103(로봇 컨트롤러) → 10.21.31.106(해당 로봇의 NOS).
    유효하지 않은 IP(빈값·127.0.0.1 등)면 ValueError.
    """
    parts = (robot_ip or "").strip().split(".")
    if len(parts) != 4 or not all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
        raise ValueError(f"유효하지 않은 로봇 IP: {robot_ip!r}")
    if parts[0] == "127":
        raise ValueError(f"로컬호스트 IP는 맵 서버가 없습니다: {robot_ip!r}")
    return f"{parts[0]}.{parts[1]}.{parts[2]}.{NOS_HOST_OCTET}"


def get_ssh_client(retries=10, host: str | None = None):
    """NOS에 SSH 연결 (불안정 네트워크 대비 — 최대 10회 재시도).

    host 미지정 시 env NOS_HOST(기본/매핑용). 가져오기 등 로봇별 작업은
    nos_host_for_robot_ip() 로 유도한 호스트를 넘긴다.
    """
    target = host or NOS_HOST
    last_error = None
    for attempt in range(1, retries + 1):
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(
                hostname=target,
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
            print(f"[SSH] 연결 실패 {target} ({attempt}/{retries}): {e}")
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


def start_relay_map(client: paramiko.SSHClient) -> None:
    """로봇에서 relay_map.py(실시간 매핑 릴레이)를 미실행 시 자동 기동한다.

    relay 기동에 실패해도 drmap 매핑/저장 자체는 정상 진행되어야 하므로,
    예외를 삼키고 경고만 남긴다(실패 시 실시간 캔버스만 비고 매핑은 계속).

    점검(pgrep)·정리(pkill)는 [m] 브래킷 트릭으로 패턴을 만들어, 명령 자신의
    셸 프로세스가 패턴에 매칭되어 오탐되는 것을 방지한다.
    """
    try:
        # 1) 이미 실행 중인지 점검 — 점검 명령 자기 자신은 "relay_[m]ap.py" 라
        #    실제 프로세스("...relay_map.py")만 매칭된다.
        check = ("sudo bash -c 'pgrep -f \"relay_[m]ap.py\" > /dev/null "
                 "&& echo RUNNING || echo STOPPED'")
        status = ssh_exec(client, check, exec_timeout=10)
        if "RUNNING" in status:
            print("📡 relay_map.py 이미 실행 중 — 자동 기동 생략")
            return

        # 2) 미실행 → ROS2 환경 source 후 백그라운드로 기동.
        #    ⚠️ ssh_exec 는 get_pty=True 라 채널이 닫힐 때 PTY 세션 전체에 SIGHUP 이 가서
        #       백그라운드 relay 가 즉시 죽는다(로그 파일조차 안 생김). 따라서 여기서는
        #       **PTY 없이(get_pty=False)** + sudo -S(stdin 비번) + setsid + </dev/null 로
        #       제어터미널에서 완전히 분리해 기동한다(채널 종료와 무관하게 생존).
        inner = f"source {NOS_ROS2_SETUP} && exec python3 -u {NOS_RELAY_SCRIPT}"
        launch = (f"sudo -S bash -c 'setsid bash -c \"{inner}\" "
                  f"> {NOS_RELAY_LOG} 2>&1 < /dev/null &'")
        stdin, _stdout, _stderr = client.exec_command(launch, get_pty=False, timeout=15)
        stdin.write(NOS_PASSWORD + "\n")   # sudo -S 비밀번호
        stdin.flush()
        time.sleep(2)                       # 비번 처리 + setsid 분리 시간 확보
        try:
            stdin.channel.shutdown_write()
        except Exception:
            pass
        print(f"📡 relay_map.py 자동 기동 (PTY 없이 detach, 로그: {NOS_RELAY_LOG})")
    except Exception as e:
        print(f"[WARN] relay_map.py 자동 기동 실패(매핑은 계속 진행): {e}")


def stop_relay_map(client: paramiko.SSHClient) -> None:
    """매핑 종료/취소 시 relay_map.py 를 정리한다(실패는 무시)."""
    try:
        ssh_exec(client, "sudo bash -c 'pkill -f \"relay_[m]ap.py\"'", exec_timeout=10)
        print("📴 relay_map.py 종료")
    except Exception as e:
        print(f"[WARN] relay_map.py 종료 실패: {e}")


def read_active_target(client: paramiko.SSHClient) -> str:
    """현재 active 심볼릭 링크가 실제로 가리키는 경로를 반환(없으면 '')."""
    try:
        return ssh_exec(client, f"readlink -f {NOS_MAP_BASE_DIR}/active 2>/dev/null").strip()
    except Exception as e:
        print(f"[WARN] active 링크 조회 실패: {e}")
        return ""


def map_dir_is_complete(client: paramiko.SSHClient, map_dir: str) -> bool:
    """맵 디렉토리가 완전한지(localization 로드 가능) 판정 — full_cloud.pcd 존재로 본다.

    매핑이 완료 전 중단되면 blocks/ 만 있고 full_cloud.pcd(매핑 종료 시 생성)가 없어,
    이 맵을 active 로 걸면 localization 이 맵을 못 불러와 로봇 pose 가 발산한다.
    """
    if not map_dir:
        return False
    try:
        r = ssh_exec(client, f"test -f {map_dir}/full_cloud.pcd && echo OK || echo NO").strip()
        return r.endswith("OK")
    except Exception as e:
        print(f"[WARN] 맵 완전성 확인 실패({map_dir}): {e}")
        return False


def restore_active(client: paramiko.SSHClient, target: str) -> bool:
    """active 링크를 이전 정상 맵(target)으로 복원하고 localization 재시작.

    - target 이 없거나/디렉토리가 사라졌거나/미완성 맵이면, 깨진 맵을 가리키지 않도록 active 를 제거(초기화).
    - ⚠️ active 가 (심볼릭이 아니라) 실제 디렉토리로 깨져 있을 수 있다(매핑 중단 잔재). 이때 `rm -f`는
      디렉토리를 못 지워 교체가 먹히지 않으므로 `rm -rf`로 제거한다(후행 슬래시 없음 → 심볼릭이면 링크만 제거).
    - 복원 성공 시 True.
    """
    if not target:
        try:
            ssh_exec(client, f"sudo rm -rf {NOS_MAP_BASE_DIR}/active")
            print("[MAP] 복원 대상 없음 — active 링크 제거(초기화)")
        except Exception as e:
            print(f"[WARN] active 링크 제거 실패: {e}")
        return False
    try:
        exists = ssh_exec(client, f"test -d {target} && echo OK || echo NO").strip()
        if not exists.endswith("OK"):
            ssh_exec(client, f"sudo rm -rf {NOS_MAP_BASE_DIR}/active")
            print(f"[MAP] 이전 active 대상 없음({target}) — active 링크 제거(초기화)")
            return False
        if not map_dir_is_complete(client, target):
            ssh_exec(client, f"sudo rm -rf {NOS_MAP_BASE_DIR}/active")
            print(f"[MAP] 복원 대상이 미완성 맵({target}, full_cloud.pcd 없음) — active 제거(초기화)")
            return False
        ssh_exec(client, f"sudo rm -rf {NOS_MAP_BASE_DIR}/active && sudo ln -s {target} {NOS_MAP_BASE_DIR}/active")
        ssh_exec(client, "sudo systemctl restart localization")
        print(f"[MAP] active 복원: → {target} (localization 재시작)")
        return True
    except Exception as e:
        print(f"[WARN] active 복원 실패: {e}")
        return False


# ══════════════════════════════════════
# 공용 헬퍼 — 로봇 맵 목록 조회 / 다운로드 (매핑 종료·가져오기 공용)
# ══════════════════════════════════════
import re as _re

_MAP_DIR_TS = _re.compile(r"^(?P<name>.+)-(?P<ts>\d{8}-\d{6})$")


def list_robot_maps(client: paramiko.SSHClient) -> list[dict]:
    """NOS의 맵 베이스 디렉토리를 나열하여 맵 목록을 반환한다.

    각 항목: {dir, name, created_at, complete(pgm+yaml 존재), has_zip, is_active}
    - complete=False 는 매핑 중단 등 미완결 맵(가져오기 불가, 표시는 가능).
    - is_active 는 NOS의 active 심볼릭 링크 대상과 일치하는 디렉토리.
    """
    active = read_active_target(client)
    # 한 번의 SSH 호출로 디렉토리별 (zip/완료/수정시각)을 한 줄씩 출력
    script = (
        "sudo bash -c '"
        f"cd {NOS_MAP_BASE_DIR} 2>/dev/null || exit 0; "
        "for d in */; do d=${d%/}; "
        "[ \"$d\" = active ] && continue; "
        f"c=NO; [ -e \"$d/{NOS_PGM_FILENAME}\" ] && [ -e \"$d/{NOS_YAML_FILENAME}\" ] && c=YES; "
        "z=NO; [ -e \"$d.zip\" ] && z=YES; "
        "t=$(stat -c %Y \"$d\" 2>/dev/null); "
        "echo \"$d|$c|$z|$t\"; done'"
    )
    out = ssh_exec(client, script, exec_timeout=30)
    maps: list[dict] = []
    for line in out.split("\n"):
        line = line.strip()
        if not line or "|" not in line:
            continue
        parts = line.split("|")
        if len(parts) < 4:
            continue
        d, c, z, t = parts[0], parts[1], parts[2], parts[3]
        m = _MAP_DIR_TS.match(d)
        if m:
            name = m.group("name")
            ts = m.group("ts")
            created_at = f"{ts[0:4]}-{ts[4:6]}-{ts[6:8]} {ts[9:11]}:{ts[11:13]}:{ts[13:15]}"
        else:
            name = d
            created_at = ""
        full = f"{NOS_MAP_BASE_DIR}/{d}"
        maps.append({
            "dir": d,
            "name": name,
            "created_at": created_at,
            "complete": (c == "YES"),
            "has_zip": (z == "YES"),
            "is_active": bool(active) and (active == full or os.path.basename(active) == d),
        })
    # 최신순 정렬(이름 기반 — dir 에 타임스탬프 포함)
    maps.sort(key=lambda x: x["dir"], reverse=True)
    return maps


def download_robot_map(client: paramiko.SSHClient, map_dir: str, map_name: str) -> dict:
    """로봇의 맵 디렉토리(map_dir)를 관제 로컬(static/maps)로 내려받고 PNG까지 생성한다.

    매핑 종료(/end)와 가져오기(/maps/import)가 공유하는 다운로드 핵심 로직.
    반환: DB 저장용 상대경로 dict {pgm, yaml, img, zip, dir_basename}.
    """
    import cv2

    dir_basename = os.path.basename(map_dir.rstrip("/"))
    remote_zip = f"{NOS_MAP_BASE_DIR}/{dir_basename}.zip"

    # 1) zip 압축 (이미 있으면 zip -ry 가 갱신; 동기화용 산출물)
    zip_cmd = f"cd {NOS_MAP_BASE_DIR} && sudo zip -ry {dir_basename}.zip {dir_basename}"
    ssh_exec(client, zip_cmd, exec_timeout=120)
    print(f"📦 zip 압축: {remote_zip}")

    # 2) SFTP 다운로드 (pgm/yaml/zip)
    sftp = client.open_sftp()
    os.makedirs(LOCAL_MAPS_DIR, exist_ok=True)
    local_pgm = os.path.join(LOCAL_MAPS_DIR, f"{map_name}.pgm")
    local_yaml = os.path.join(LOCAL_MAPS_DIR, f"{map_name}.yaml")
    local_zip = os.path.join(LOCAL_MAPS_DIR, f"{dir_basename}.zip")
    try:
        sftp.get(f"{map_dir}/{NOS_PGM_FILENAME}", local_pgm)
        sftp.get(f"{map_dir}/{NOS_YAML_FILENAME}", local_yaml)
        sftp.get(remote_zip, local_zip)
    finally:
        sftp.close()
    print(f"📥 SFTP 다운로드 완료: {map_name} (pgm/yaml/zip)")

    # 3) PGM → PNG 변환
    local_png = os.path.join(LOCAL_MAPS_DIR, f"{map_name}.png")
    img = cv2.imread(local_pgm, cv2.IMREAD_GRAYSCALE)
    if img is not None:
        cv2.imwrite(local_png, img)
        print(f"🖼️ PGM → PNG 변환 완료: {local_png}")
    else:
        print("[WARN] PGM 읽기 실패, PNG 변환 건너뜀")

    return {
        "pgm": f"./static/maps/{map_name}.pgm",
        "yaml": f"./static/maps/{map_name}.yaml",
        "img": f"./static/maps/{map_name}.png",
        "zip": f"./static/maps/{dir_basename}.zip",
        "dir_basename": dir_basename,
    }


# ══════════════════════════════════════
# 매핑 시작
# ══════════════════════════════════════
class MappingStartReq(BaseModel):
    BusinessId: int
    FloorId: int
    MapName: str


@mapping_ctrl.post("/start")
def mapping_start(req: MappingStartReq, current_user: UserInfo = Depends(require_permission("map-edit"))):
    if mapping_state["is_running"]:
        raise HTTPException(status_code=409, detail="이미 매핑이 진행 중입니다.")

    # 가드를 '시작 진입 즉시' 켠다. drmap 명령을 받는 순간 로봇 SLAM 이 원점으로 리셋되는데,
    # is_running 을 SSH 성공 후에 켜면 '버튼 클릭~SSH 성공' 사이 원점 리셋이 위치 급변/재부팅으로
    # 오인돼 '위치 재조정' 모달·경고가 샌다(_is_mapping 가드가 아직 꺼져 있어서).
    # → 진입 시 켜고, 시작에 실패하면 except 에서 되돌린다.
    mapping_state["is_running"] = True
    mapping_state["map_name"] = req.MapName
    mapping_state["business_id"] = req.BusinessId
    mapping_state["floor_id"] = req.FloorId

    client = None
    try:
        # 1. drmap mapping 실행 (SSH 실패 시 재접속하여 재시도)
        command = f"sudo drmap mapping -n {req.MapName}"
        start_success = False
        snapshotted = False
        for attempt in range(3):
            try:
                client = get_ssh_client()
                # drmap 이 active 를 새 맵으로 물기 전에, 이전 정상 맵을 스냅샷해 둔다.
                # (종료 안 하고 취소/새로고침으로 중단되면 이 값으로 active 를 복원/초기화)
                if not snapshotted:
                    mapping_state["prev_active"] = read_active_target(client)
                    snapshotted = True
                    print(f"[MAP] 매핑 시작 전 active 스냅샷: {mapping_state['prev_active'] or '(없음)'}")
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

        # drmap 매핑이 시작됐으면 실시간 시각화 릴레이(relay_map.py)도 자동 기동한다.
        # (relay 가 떠야 브라우저 매핑 캔버스에 점군/odom 이 실시간으로 그려진다.)
        start_relay_map(client)

        # is_running/map_name/business_id/floor_id 는 진입 시 이미 설정됨(가드 조기 활성화).
        print(f"🗺️ 매핑 시작: {req.MapName}")
        return {"status": "ok", "message": "매핑이 시작되었습니다."}

    except Exception as e:
        # 시작 실패 → 조기 활성화한 가드/상태를 롤백(매핑 미진행으로 복귀).
        mapping_state["is_running"] = False
        mapping_state["map_name"] = None
        mapping_state["business_id"] = None
        mapping_state["floor_id"] = None
        mapping_state["prev_active"] = None
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
    FloorId: int
    MapName: str


@mapping_ctrl.post("/end")
def mapping_end(req: MappingEndReq, db: Session = Depends(get_db), current_user: UserInfo = Depends(require_permission("map-edit"))):
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

        # 매핑이 끝났으니 실시간 시각화 릴레이(relay_map.py)도 정리한다.
        stop_relay_map(client)

        # 2. 맵 디렉토리 생성 대기 (최대 60초, SSH 끊기면 재접속)
        map_dir = ""
        find_cmd = f"sudo ls -dt {NOS_MAP_BASE_DIR}/{req.MapName}-*/ 2>/dev/null | head -1"

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
            raise Exception(f"맵 디렉토리를 찾을 수 없습니다: {NOS_MAP_BASE_DIR}/{req.MapName}-*")

        print(f"📂 맵 디렉토리 발견: {map_dir}")

        # 3~4. zip 압축 + SFTP 다운로드 + PGM→PNG (가져오기와 공용 헬퍼)
        paths = download_robot_map(client, map_dir, req.MapName)

        # 5. SSH 연결 종료
        client.close()
        client = None

        # 7. DB에 맵 정보 저장
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

        # 8. 상태 초기화 (정상 종료 → active 는 방금 완성된 새 맵이 맞으므로 복원하지 않음)
        mapping_state["is_running"] = False
        mapping_state["map_name"] = None
        mapping_state["business_id"] = None
        mapping_state["floor_id"] = None
        mapping_state["prev_active"] = None

        print(f"✅ 매핑 완료 & 저장: {req.MapName}")
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
def mapping_cancel(current_user: UserInfo = Depends(require_permission("map-edit"))):
    """매핑 취소(저장 없이 종료).

    종료(/end) 없이 중단된 경우 active 가 미완결 맵에 고착되므로,
    시작 시 스냅샷한 이전 정상 맵으로 active 를 복원(없으면 초기화)하고 localization 을 재시작한다.
    """
    map_name = mapping_state.get("map_name")
    prev_active = mapping_state.get("prev_active")
    client = None

    try:
        client = get_ssh_client()
        ssh_exec(client, "sudo drmap stop_mapping")

        # 실시간 시각화 릴레이(relay_map.py)도 정리한다.
        stop_relay_map(client)

        if map_name:
            time.sleep(2)
            ssh_exec(client, f"sudo rm -rf {NOS_MAP_BASE_DIR}/{map_name}-*/")
            print(f"🗑️ 맵 디렉토리 삭제: {map_name}-*/")

        # active 복원/초기화: 미완결 맵(또는 방금 삭제된 디렉토리)을 가리키지 않도록
        # 이전 정상 맵으로 되돌린다. prev_active 가 없으면 active 링크 자체를 제거한다.
        restore_active(client, prev_active or "")
    except Exception as e:
        print(f"[ERR] 매핑 취소 중 오류: {e}")
    finally:
        if client:
            try: client.close()
            except: pass
        mapping_state["is_running"] = False
        mapping_state["map_name"] = None
        mapping_state["business_id"] = None
        mapping_state["floor_id"] = None
        mapping_state["prev_active"] = None

    print("🚫 매핑 취소됨")
    return {"status": "ok", "message": "매핑이 취소되었습니다."}


# ══════════════════════════════════════
# 매핑 상태 조회
# ══════════════════════════════════════
@mapping_ctrl.get("/status")
def mapping_status(current_user: UserInfo = Depends(require_permission("map-edit"))):
    return {
        "is_running": mapping_state["is_running"],
        "map_name": mapping_state["map_name"],
    }
