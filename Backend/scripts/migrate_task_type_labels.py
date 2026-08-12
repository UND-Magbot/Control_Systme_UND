"""
작업유형(TaskType) 원시값 일괄 치환 마이그레이션 (1회용, 멱등)
─────────────────────────────────────────────────────────────
플레이스홀더 task1/task2/task3/test 로 저장된 way_info · schedule_info 의
TaskType 을 현행 표준 라벨로 치환한다. 프론트의 resolveTaskTypeLabel(무손실
표시 정규화)과 동일한 매핑을 DB 원시값에도 영구 반영해 별칭 의존을 제거한다.

  task1 → 길 안내
  task2 → 물품 운반
  task3 → 순찰·점검
  test  → 길 안내   (구 테스트값도 안내로 흡수)

멱등: 이미 표준 라벨인 행은 건드리지 않으므로 여러 번 실행해도 안전하다.

실행 (Backend 디렉토리에서):
    python scripts/migrate_task_type_labels.py                 # dry-run (현황만, 변경 없음)
    python scripts/migrate_task_type_labels.py --apply         # task1/2/3 실제 UPDATE + 커밋
    python scripts/migrate_task_type_labels.py --include-test  # test 도 대상에 포함(기본 제외)

기본은 dry-run 이다. 실제 반영은 반드시 --apply 를 붙여야 한다.
`test` 는 버려도 되는 테스트 데이터일 수 있어 **기본 제외**하며, 포함하려면
--include-test 를 붙인다.
"""
import os
import sys

# Backend 루트를 import 경로에 추가 (scripts/ → 상위)
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND_ROOT)

# database 모듈 import 전에 .env 를 로드해야 DATABASE_URL fail-fast 를 통과한다
# (mapping_control.py 와 동일 패턴: Backend/.env → 상위/.env 순).
try:
    from dotenv import load_dotenv  # noqa: E402

    load_dotenv(os.path.join(_BACKEND_ROOT, ".env"))
    load_dotenv(os.path.join(os.path.dirname(_BACKEND_ROOT), ".env"))
except Exception:
    pass

from sqlalchemy import update  # noqa: E402

from app.database.database import SessionLocal  # noqa: E402
from app.database.models import WayInfo, ScheduleInfo  # noqa: E402

# 구 원시값 → 현행 표준 라벨. 프론트 @/app/lib/taskType 의 LEGACY_TASK_TYPE_ALIASES 와 동일.
# task1/2/3 은 항상 대상. test 는 옵션(--include-test)일 때만 포함한다.
CORE_MAP: dict[str, str] = {
    "task1": "길 안내",
    "task2": "물품 운반",
    "task3": "순찰·점검",
}
TEST_MAP: dict[str, str] = {
    "test": "길 안내",
}

# (모델, 사람이 읽을 테이블명) — TaskType 컬럼을 가진 대상.
TARGETS = [
    (WayInfo, "way_info"),
    (ScheduleInfo, "schedule_info"),
]


def main() -> None:
    apply = "--apply" in sys.argv
    include_test = "--include-test" in sys.argv
    legacy_to_label = {**CORE_MAP, **(TEST_MAP if include_test else {})}
    mode = "APPLY(실제 반영)" if apply else "DRY-RUN(현황만)"
    test_note = "포함" if include_test else "제외(기본)"
    print(f"작업유형 원시값 치환 — 모드: {mode} · test: {test_note}\n")

    db = SessionLocal()
    total_changed = 0
    try:
        for model, table_name in TARGETS:
            print(f"[{table_name}]")
            table_changed = 0
            for legacy, new_label in legacy_to_label.items():
                cnt = (
                    db.query(model)
                    .filter(model.TaskType == legacy)
                    .count()
                )
                if cnt == 0:
                    continue
                table_changed += cnt
                arrow = "→ 반영" if apply else "→ 반영 예정"
                print(f"  {legacy:<6} = {cnt:>4}건  {arrow} '{new_label}'")

                if apply:
                    db.execute(
                        update(model)
                        .where(model.TaskType == legacy)
                        .values(TaskType=new_label)
                    )

            if table_changed == 0:
                print("  치환 대상 없음 (이미 표준 라벨).")
            total_changed += table_changed
            print()

        if apply:
            db.commit()
            print(f"완료: 총 {total_changed}건 커밋됨.")
        else:
            print(
                f"DRY-RUN 종료: 총 {total_changed}건이 치환 대상. "
                "실제 반영하려면 --apply 를 붙여 다시 실행하세요."
            )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
