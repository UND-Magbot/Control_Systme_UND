"""웨이포인트 계산 공통 헬퍼."""

import json
import math
from typing import Iterable, List, Optional

from app.database.models import LocationInfo


def parse_wait_seconds(raw: Optional[str], length: int) -> List[int]:
    """`WayInfo.WaitSeconds` JSON 문자열을 length 길이의 정수 리스트로 정규화.

    파싱 실패·길이 부족·음수·비정수는 0으로 대체한다.
    """
    if not raw:
        return [0] * length
    try:
        parsed = json.loads(raw)
    except Exception:
        return [0] * length
    if not isinstance(parsed, list):
        return [0] * length
    result: List[int] = []
    for i in range(length):
        v = parsed[i] if i < len(parsed) else 0
        try:
            iv = int(v)
        except (TypeError, ValueError):
            iv = 0
        result.append(iv if iv > 0 else 0)
    return result


def build_waypoints_from_places(
    places: Iterable[LocationInfo],
    wait_seconds: Optional[List[int]] = None,
) -> List[dict]:
    """장소 목록 → 웨이포인트 dict 목록.

    yaw 규칙:
    - 마지막 포인트: 저장된 Yaw 사용 (없으면 0.0)
    - 그 외: 다음 포인트를 향하는 방향으로 계산 (atan2)

    wait_seconds: 각 포인트 도착 후 대기(초). 미지정 시 모두 0.
    """
    places = list(places)
    waits = wait_seconds or [0] * len(places)
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
            "wait_seconds": waits[i] if i < len(waits) else 0,
        })
    return waypoints
