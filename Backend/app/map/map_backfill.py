"""맵 이미지(PNG) 백필 — 인스턴스별 로컬 static/maps에 누락된 png를 복구한다.

여러 백엔드 인스턴스가 DB(RobotMapInfo)는 공유하지만 static/maps 파일은
인스턴스별 로컬이라, '맵 가져오기'를 수행한 인스턴스에만 png가 생긴다.
다른 인스턴스는 DB의 ImgFilePath가 가리키는 png 파일이 없어 맵 이미지가
404가 된다. 이 모듈은 DB에 등록된 맵 기준으로 로컬에 png가 없으면 다음
순서로 복구한다 (네트워크 비용이 낮은 순):

  1) 로컬 pgm 있음        → cv2로 png 생성 (네트워크 불필요)
  2) 로컬 zip 있음        → zip에서 occ_grid.pgm/yaml 추출 후 png 생성
  3) 로컬 소스 전혀 없음   → (allow_robot_fetch=True 시) 로봇(NOS)에서 재다운로드

기동 시(main startup) 백그라운드 자동 호출 + CLI 단독 실행을 모두 지원한다.

CLI:
    python -m app.map.map_backfill            # 로봇 재다운로드까지 허용
    python -m app.map.map_backfill --no-robot # 로컬 소스(pgm/zip)만으로 복구
"""
import os
import zipfile

from app.map.mapping_control import LOCAL_MAPS_DIR


def _png_from_pgm(pgm_path: str, png_path: str) -> bool:
    """pgm을 그레이스케일로 읽어 png로 저장. 성공 시 True."""
    if not os.path.exists(pgm_path):
        return False
    import cv2
    img = cv2.imread(pgm_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return False
    cv2.imwrite(png_path, img)
    return True


def _restore_pgm_from_zip(zip_path: str, map_name: str) -> bool:
    """로봇 맵 zip(`dir_basename/occ_grid.*`)에서 pgm/yaml을 로컬에 복원.

    pgm 복원 성공 시 True. yaml은 없으면 함께 복원하되 실패해도 무시.
    """
    from app.map.mapping_control import NOS_PGM_FILENAME, NOS_YAML_FILENAME

    if not zip_path or not os.path.exists(zip_path):
        return False
    pgm_local = os.path.join(LOCAL_MAPS_DIR, f"{map_name}.pgm")
    yaml_local = os.path.join(LOCAL_MAPS_DIR, f"{map_name}.yaml")
    try:
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
            pgm_member = next((n for n in names if n.endswith(NOS_PGM_FILENAME)), None)
            yaml_member = next((n for n in names if n.endswith(NOS_YAML_FILENAME)), None)
            if not pgm_member:
                return False
            with zf.open(pgm_member) as src, open(pgm_local, "wb") as dst:
                dst.write(src.read())
            if yaml_member and not os.path.exists(yaml_local):
                with zf.open(yaml_member) as src, open(yaml_local, "wb") as dst:
                    dst.write(src.read())
        return True
    except Exception as e:
        print(f"[BACKFILL] {map_name}: zip 복원 실패({zip_path}): {e}")
        return False


def _fetch_from_robot(db, m) -> bool:
    """로컬 소스가 없을 때 로봇(NOS)에서 맵을 재다운로드(+png 생성)한다.

    RobotMapInfo에는 RobotId가 없으므로 BusinessId로 로봇을 찾고,
    로봇 디렉토리명은 ZipFilePath(`.../<dir_basename>.zip`)에서 복원한다.
    """
    from app.database.models import RobotInfo
    from app.map.mapping_control import (
        get_ssh_client, download_robot_map, nos_host_for_robot_ip, NOS_MAP_BASE_DIR,
    )

    if not m.ZipFilePath:
        print(f"[BACKFILL] {m.MapName}: ZipFilePath 없음 — 로봇 디렉토리 복원 불가")
        return False
    dir_basename = os.path.splitext(os.path.basename(m.ZipFilePath))[0]

    robot = (db.query(RobotInfo)
             .filter(RobotInfo.BusinessId == m.BusinessId)
             .order_by(RobotInfo.id).first())
    if not robot:
        print(f"[BACKFILL] {m.MapName}: 사업장({m.BusinessId}) 로봇 없음 — 로봇 가져오기 불가")
        return False
    try:
        nos_host = nos_host_for_robot_ip(robot.RobotIP)
    except ValueError:
        print(f"[BACKFILL] {m.MapName}: 로봇 IP 무효({robot.RobotIP})")
        return False

    client = None
    try:
        client = get_ssh_client(retries=2, host=nos_host)
        download_robot_map(client, f"{NOS_MAP_BASE_DIR}/{dir_basename}", m.MapName)
        return True
    except Exception as e:
        print(f"[BACKFILL] {m.MapName}: 로봇 다운로드 실패({nos_host}): {e}")
        return False
    finally:
        if client:
            try:
                client.close()
            except Exception:
                pass


def backfill_map_images(db=None, allow_robot_fetch: bool = True) -> dict:
    """DB 등록 맵 기준으로 로컬에 png가 없으면 재생성한다.

    Args:
        db: 외부 세션(없으면 자체 생성/정리).
        allow_robot_fetch: 로컬 pgm/zip이 모두 없을 때 로봇(NOS)에서 재다운로드 허용.

    Returns:
        {'checked', 'ok', 'from_pgm', 'from_zip', 'from_robot', 'failed'} 요약.
    """
    from app.database.models import RobotMapInfo

    own_session = db is None
    if own_session:
        from app.database.database import SessionLocal
        db = SessionLocal()

    summary = {"checked": 0, "ok": 0, "from_pgm": 0, "from_zip": 0, "from_robot": 0, "failed": []}
    try:
        os.makedirs(LOCAL_MAPS_DIR, exist_ok=True)
        for m in db.query(RobotMapInfo).all():
            summary["checked"] += 1
            png_local = os.path.join(LOCAL_MAPS_DIR, f"{m.MapName}.png")
            if os.path.exists(png_local):
                continue

            pgm_local = os.path.join(LOCAL_MAPS_DIR, f"{m.MapName}.pgm")
            zip_local = os.path.join(LOCAL_MAPS_DIR, os.path.basename(m.ZipFilePath or ""))

            # 1) 로컬 pgm → png
            if _png_from_pgm(pgm_local, png_local):
                summary["ok"] += 1
                summary["from_pgm"] += 1
                print(f"[BACKFILL] {m.MapName}: pgm→png 생성")
                continue

            # 2) 로컬 zip → pgm → png
            if _restore_pgm_from_zip(zip_local, m.MapName) and _png_from_pgm(pgm_local, png_local):
                summary["ok"] += 1
                summary["from_zip"] += 1
                print(f"[BACKFILL] {m.MapName}: zip→pgm→png 생성")
                continue

            # 3) 로봇(NOS)에서 재다운로드 (pgm/yaml/zip + png)
            if allow_robot_fetch and _fetch_from_robot(db, m) and os.path.exists(png_local):
                summary["ok"] += 1
                summary["from_robot"] += 1
                print(f"[BACKFILL] {m.MapName}: 로봇 다운로드→png 생성")
                continue

            summary["failed"].append(m.MapName)
            print(f"[BACKFILL] {m.MapName}: png 복구 실패 "
                  f"(로컬 pgm/zip 없음, 로봇 fetch={'시도함' if allow_robot_fetch else '비활성'})")
        return summary
    finally:
        if own_session:
            db.close()


if __name__ == "__main__":
    import sys

    allow = "--no-robot" not in sys.argv
    result = backfill_map_images(allow_robot_fetch=allow)
    print(f"[BACKFILL] 완료: {result}")
