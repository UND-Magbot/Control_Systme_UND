"""웨이포인트 계산 공통 헬퍼."""

import math
from typing import Iterable, List

from app.database.models import LocationInfo


def build_waypoints_from_places(places: Iterable[LocationInfo]) -> List[dict]:
    """장소 목록 → 웨이포인트 dict 목록.

    yaw 규칙:
    - 마지막 포인트: 저장된 Yaw 사용 (없으면 0.0)
    - 그 외: 다음 포인트를 향하는 방향으로 계산 (atan2)
    """
    places = list(places)
    waypoints = []
    for i, place in enumerate(places):
        x = place.LocationX
        y = place.LocationY
        if i < len(places) - 1:
            nx = places[i + 1].LocationX
            ny = places[i + 1].LocationY
            yaw = math.atan2(ny - y, nx - x)
        else:
            yaw = place.Yaw or 0.0
        waypoints.append({
            "x": x,
            "y": y,
            "yaw": round(yaw, 3),
            "name": place.LacationName,
        })
    return waypoints
