"""장소 Yaw 규약 점검 (읽기 전용 · 파괴적 변경 없음).

배경: 프론트가 방향을 UI 위젯 규약(0°=화면 위, 시계)으로 다루지만, DB의
LocationInfo.Yaw 는 ROS 표준(0=지도 +X축, 반시계, 라디안)으로 저장된다.
과거 프론트는 두 규약 사이 변환 없이 deg=Yaw*180/pi(identity)로 표시·저장해
'화살표 방향'이 로봇 실제 헤딩과 어긋나 보였다.

이 스크립트는 각 장소의 저장된 Yaw 가 어떤 출처(로봇 캡처=올바른 ROS / 휠 입력 의심)
인지 진단하고, 규약 수정된 프론트에서 어떻게 표시될지 미리 보여준다.

핵심 결론(대개): Yaw<0 이나 비정형 각도는 로봇 캡처된 '올바른 ROS' 값이므로
    DB 마이그레이션(값 변환)을 하면 오히려 손상된다. 규약 수정은 프론트 코드에서만
    처리하면 되고(표시/저장 시 UI°=90-deg 변환), 기존 DB Yaw 는 건드리지 않는다.

실행(컨테이너 파이썬으로 파이프, 재빌드 불필요):
    docker exec -i control-backend python - < Backend/scripts/inspect_place_yaw.py
"""
import math

from app.database.database import SessionLocal
from app.database.models import LocationInfo


def ui_deg_from_yaw(yaw_rad: float) -> int:
    """수정된 프론트와 동일한 변환: ROS yaw(rad) -> UI 방향(도, 0=위·시계)."""
    deg = 90.0 - math.degrees(yaw_rad)
    return round(((deg % 360) + 360) % 360)


def classify(yaw_rad: float) -> str:
    if yaw_rad == 0.0:
        return "미설정/0(휠 0°=위 or place탭 드롭)"
    if yaw_rad < 0:
        return "로봇캡처(올바른 ROS) — 마이그레이션 금지"
    return "양수: 로봇캡처 or 휠 — 값만으론 구분 불가"


def main() -> None:
    db = SessionLocal()
    try:
        rows = (
            db.query(LocationInfo)
            .filter((LocationInfo.Category != "danger") | (LocationInfo.Category.is_(None)))
            .order_by(LocationInfo.id.asc())
            .all()
        )
        neg = sum(1 for r in rows if (r.Yaw or 0) < 0)
        zero = sum(1 for r in rows if (r.Yaw or 0) == 0)
        print(f"총(위험구역 제외): {len(rows)}  |  Yaw<0(로봇캡처 확정): {neg}  |  Yaw==0: {zero}")
        print("Yaw<0 값이 존재하면 = UI 휠(0~360°→양수 라디안)로 만들 수 없음 = 로봇 캡처된 올바른 ROS.")
        print("→ 값 변환 마이그레이션은 이 올바른 값들을 손상시킴. 규약 수정은 프론트에서만.\n")
        print(f"{'id':>5} {'name':16} {'cat':9} {'Yaw(rad)':>9} {'ROS°':>7} {'수정후UI°':>8}  판정")
        print("-" * 92)
        for r in rows:
            y = r.Yaw or 0.0
            print(
                f"{r.id:>5} {str(r.LacationName)[:16]:16} {str(r.Category)[:9]:9} "
                f"{y:>+9.4f} {math.degrees(y):>+7.1f} {ui_deg_from_yaw(y):>7}°  {classify(y)}"
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
