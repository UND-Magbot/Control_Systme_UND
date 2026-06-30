"""
기존 맵 파일 → 공유 DB BLOB 백필 (1회용)
─────────────────────────────────────────
이 PC 의 static/maps 에 이미 있는 맵 파일(pgm/yaml/png/zip)을 공유 DB
(robot_map_file)로 올린다. 백엔드 도입 전에 만들어진 맵들이 다른 PC 에서도
보이도록 하기 위한 마이그레이션 스크립트.

실행 (Backend 디렉토리에서):
    python scripts/backfill_map_files.py            # 전체 맵 백필
    python scripts/backfill_map_files.py --status   # 업로드 없이 현황만 출력
"""
import os
import sys

# Backend 루트를 import 경로에 추가 (scripts/ → 상위)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.database import SessionLocal, engine, Base  # noqa: E402
from app.database.models import RobotMapInfo  # noqa: E402
from app.map.map_file_store import store_map_files, file_status  # noqa: E402


def main() -> None:
    status_only = "--status" in sys.argv

    # robot_map_file 테이블 보장 (모델 기준 생성)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        maps = db.query(RobotMapInfo).order_by(RobotMapInfo.id.asc()).all()
        print(f"대상 맵 {len(maps)}개\n")
        for m in maps:
            if status_only:
                st = file_status(db, m)
                summary = " ".join(
                    f"{k}:{'L' if v['local'] else '-'}{'D' if v['db'] else '-'}"
                    for k, v in st.items()
                )
                print(f"[{m.id}] {m.MapName:<28} {summary}")
                continue

            res = store_map_files(db, m)
            ok = [k for k, v in res.items() if v]
            skip = [k for k, v in res.items() if not v]
            print(f"[{m.id}] {m.MapName:<28} 업로드: {ok or '없음'}"
                  + (f" / 로컬없음: {skip}" if skip else ""))
        print("\n완료.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
