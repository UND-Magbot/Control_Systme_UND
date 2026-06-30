"""
맵 실물 파일 중앙 저장소 (공유 MySQL BLOB)
────────────────────────────────────────────
관제 PC 여러 대가 단일 공유 DB(예: 192.168.0.21)만 바라보고 동작하도록,
맵 실물 파일(pgm/yaml/png/zip)을 robot_map_file 테이블에 청크 BLOB 으로 보관한다.

설계 요지
  - 메타데이터(RobotMapInfo)는 이미 공유 DB 에 있으나 실물 파일은 각 PC 로컬
    static/maps 에만 있어, 다른 PC 에서는 파일이 없어 맵이 안 보이는 문제가 있었다.
  - 파일을 DB BLOB 으로 올려두면 "DB 접근 권한"만으로 어느 PC든 파일을 얻는다
    (OS 마운트 같은 PC 별 설정 불필요).
  - max_allowed_packet(MySQL 기본 16MB)을 넘기지 않도록 CHUNK_SIZE(4MB) 로 분할.
  - 로컬 static/maps 는 DB 의 read-through 캐시 — 두 번째 접근부터는 DB 를 안 거친다.
"""
import hashlib
import os
import threading

from sqlalchemy.orm import Session

from app.database.models import RobotMapInfo, RobotMapFile

# Backend/ 루트 (app/map/map_file_store.py → 3단계 상위)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 청크 크기 — max_allowed_packet(16MB) 대비 충분한 안전 마진.
CHUNK_SIZE = 4 * 1024 * 1024  # 4MB

# Kind ↔ RobotMapInfo 경로 컬럼
KIND_COLUMNS = {
    "pgm": "PgmFilePath",
    "yaml": "YamlFilePath",
    "png": "ImgFilePath",
    "zip": "ZipFilePath",
}
ALL_KINDS = ("pgm", "yaml", "png", "zip")
# 화면 표시에 필요한 소형 파일 (조회/시작 시 우선 복원)
DISPLAY_KINDS = ("yaml", "png", "pgm")

# 맵·종류별 복원/저장 동시성 락 (중복 다운로드·쓰기 경쟁 차단)
_locks: dict[tuple[int, str], threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(map_id: int, kind: str) -> threading.Lock:
    key = (map_id, kind)
    with _locks_guard:
        lk = _locks.get(key)
        if lk is None:
            lk = threading.Lock()
            _locks[key] = lk
        return lk


def _abs_path(rel_or_abs: str | None) -> str | None:
    """RobotMapInfo 의 './static/maps/x.png' 같은 상대경로를 절대경로로."""
    if not rel_or_abs:
        return None
    if os.path.isabs(rel_or_abs):
        return rel_or_abs
    return os.path.join(BASE_DIR, rel_or_abs.replace("./", "", 1))


def _rel_path_for(m: RobotMapInfo, kind: str) -> str | None:
    return getattr(m, KIND_COLUMNS[kind], None)


def _sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


# ──────────────────────────────────────────
# 쓰기 (로컬 파일 → DB BLOB)
# ──────────────────────────────────────────
def store_file(db: Session, map_id: int, kind: str, local_path: str) -> bool:
    """로컬 파일을 청크로 나눠 robot_map_file 에 UPSERT 한다.

    파일이 없거나 비어 있으면 False. 성공 시 True.
    """
    if kind not in KIND_COLUMNS:
        raise ValueError(f"알 수 없는 맵 파일 종류: {kind}")
    if not local_path or not os.path.exists(local_path):
        return False

    sha = _sha256_file(local_path)
    with _lock_for(map_id, kind):
        # 동일 sha 가 이미 저장돼 있으면 재업로드 생략 (idempotent).
        existing = (
            db.query(RobotMapFile.Sha256)
            .filter(RobotMapFile.MapId == map_id, RobotMapFile.Kind == kind, RobotMapFile.Seq == 0)
            .first()
        )
        if existing and existing[0] == sha:
            return True

        # 기존 청크 제거 후 새로 기록
        db.query(RobotMapFile).filter(
            RobotMapFile.MapId == map_id, RobotMapFile.Kind == kind
        ).delete(synchronize_session=False)

        seq = 0
        with open(local_path, "rb") as f:
            while True:
                chunk = f.read(CHUNK_SIZE)
                if not chunk:
                    break
                db.add(RobotMapFile(MapId=map_id, Kind=kind, Seq=seq, Data=chunk, Sha256=sha))
                # 청크마다 개별 INSERT 로 강제 flush.
                # 모아서 commit 하면 SQLAlchemy 가 여러 청크를 하나의 multi-row
                # INSERT(insertmanyvalues)로 합쳐 max_allowed_packet(16MB)을 초과 →
                # 'Lost connection' 이 발생한다. 행 단위 flush 로 각 패킷을 4MB 로 유지.
                db.flush()
                seq += 1
        if seq == 0:  # 빈 파일
            db.rollback()
            return False
        db.commit()
        print(f"[MAPFILE] DB 저장: map={map_id} kind={kind} chunks={seq} sha={sha[:8]}")
        return True


def store_map_files(db: Session, m: RobotMapInfo, kinds: tuple[str, ...] = ALL_KINDS) -> dict[str, bool]:
    """맵의 로컬 파일들(존재하는 것만)을 DB 로 올린다. {kind: 성공여부}."""
    result: dict[str, bool] = {}
    for kind in kinds:
        local = _abs_path(_rel_path_for(m, kind))
        try:
            result[kind] = store_file(db, m.id, kind, local) if local else False
        except Exception as e:
            print(f"[MAPFILE] 저장 실패 map={m.id} kind={kind}: {e}")
            result[kind] = False
    return result


# ──────────────────────────────────────────
# 읽기 (DB BLOB → 로컬 파일 캐시)
# ──────────────────────────────────────────
def db_has_file(db: Session, map_id: int, kind: str) -> bool:
    return (
        db.query(RobotMapFile.id)
        .filter(RobotMapFile.MapId == map_id, RobotMapFile.Kind == kind, RobotMapFile.Seq == 0)
        .first()
        is not None
    )


def restore_file(db: Session, m: RobotMapInfo, kind: str) -> bool:
    """DB BLOB 을 로컬 static/maps 로 복원한다. DB 에 없으면 False.

    이미 로컬에 (해시 일치) 파일이 있으면 그대로 둔다.
    """
    rel = _rel_path_for(m, kind)
    local = _abs_path(rel)
    if not local:
        return False

    with _lock_for(m.id, kind):
        rows = (
            db.query(RobotMapFile.Seq, RobotMapFile.Data, RobotMapFile.Sha256)
            .filter(RobotMapFile.MapId == m.id, RobotMapFile.Kind == kind)
            .order_by(RobotMapFile.Seq.asc())
            .all()
        )
        if not rows:
            return False

        sha = rows[0][2]
        # 로컬이 이미 최신이면 생략
        if os.path.exists(local) and sha and _sha256_file(local) == sha:
            return True

        os.makedirs(os.path.dirname(local), exist_ok=True)
        tmp = local + ".part"
        h = hashlib.sha256()
        with open(tmp, "wb") as f:
            for _seq, data, _sha in rows:
                f.write(data)
                h.update(data)

        if sha and h.hexdigest() != sha:
            os.remove(tmp)
            raise ValueError(f"맵 파일 복원 해시 불일치: map={m.id} kind={kind}")

        os.replace(tmp, local)
        print(f"[MAPFILE] 로컬 복원: map={m.id} kind={kind} → {os.path.basename(local)}")
        return True


def ensure_local(db: Session, m: RobotMapInfo, kinds: tuple[str, ...] = DISPLAY_KINDS) -> dict[str, bool]:
    """필요한 kind 들이 로컬에 있도록 보장. 없으면 DB 에서 복원.

    반환: {kind: 사용가능여부(로컬에 존재)}.
    """
    result: dict[str, bool] = {}
    for kind in kinds:
        local = _abs_path(_rel_path_for(m, kind))
        if local and os.path.exists(local):
            result[kind] = True
            continue
        try:
            result[kind] = restore_file(db, m, kind)
        except Exception as e:
            print(f"[MAPFILE] 복원 실패 map={m.id} kind={kind}: {e}")
            result[kind] = False
    return result


def _local_present(m: RobotMapInfo, kind: str) -> bool:
    local = _abs_path(_rel_path_for(m, kind))
    return bool(local and os.path.exists(local))


def _expected_kinds(m: RobotMapInfo, kinds: tuple[str, ...]) -> list[str]:
    """경로 컬럼이 채워진(= 존재해야 하는) kind 만 추린다."""
    return [k for k in kinds if _rel_path_for(m, kind=k)]


def sync_all_from_db(db: Session, kinds: tuple[str, ...] = ALL_KINDS) -> dict:
    """공유 DB 맵 목록과 로컬 static/maps 를 맵 단위로 비교해 누락분을 복원한다.

    백엔드 시작 시 호출 — 예: 로컬에 5개 맵만 있고 DB 메타에 6개면 빠진 1개를
    DB BLOB 에서 내려받아 6개로 맞춘다. 모든 맵 파일이 이미 있으면 그냥 통과한다.

    반환 요약:
      db_maps           DB 메타(RobotMapInfo) 맵 수
      already_complete  복원 전부터 파일이 다 있던 맵 수
      restored_maps     이번에 일부/전부 복원한 맵 수
      restored_files    복원한 파일 수
      incomplete        복원 후에도 파일이 빠진 맵 [(id, name, [kinds])]
                        (DB BLOB 에도 없어 복구 불가 — 원본 매핑/가져오기 필요)
    """
    maps = db.query(RobotMapInfo).order_by(RobotMapInfo.id.asc()).all()
    already_complete = 0
    restored_maps = 0
    restored_files = 0
    incomplete: list[tuple[int, str, list[str]]] = []

    for m in maps:
        expected = _expected_kinds(m, kinds)
        missing_before = [k for k in expected if not _local_present(m, k)]
        if not missing_before:
            already_complete += 1
            continue

        res = ensure_local(db, m, tuple(missing_before))
        newly = [k for k in missing_before if res.get(k)]
        restored_files += len(newly)
        if newly:
            restored_maps += 1

        still_missing = [k for k in expected if not _local_present(m, k)]
        if still_missing:
            incomplete.append((m.id, m.MapName, still_missing))

    return {
        "db_maps": len(maps),
        "already_complete": already_complete,
        "restored_maps": restored_maps,
        "restored_files": restored_files,
        "incomplete": incomplete,
    }


# ──────────────────────────────────────────
# 검증 (로컬 ↔ DB 싱크 상태)
# ──────────────────────────────────────────
def file_status(db: Session, m: RobotMapInfo) -> dict:
    """맵의 각 파일이 로컬/DB 에 있는지, 해시가 일치하는지 보고한다."""
    out: dict[str, dict] = {}
    for kind in ALL_KINDS:
        rel = _rel_path_for(m, kind)
        local = _abs_path(rel)
        local_exists = bool(local and os.path.exists(local))
        db_row = (
            db.query(RobotMapFile.Sha256)
            .filter(RobotMapFile.MapId == m.id, RobotMapFile.Kind == kind, RobotMapFile.Seq == 0)
            .first()
        )
        db_sha = db_row[0] if db_row else None
        sha_match = None
        if local_exists and db_sha:
            sha_match = _sha256_file(local) == db_sha
        out[kind] = {
            "path": rel,
            "local": local_exists,
            "db": db_sha is not None,
            "sha_match": sha_match,
        }
    return out
