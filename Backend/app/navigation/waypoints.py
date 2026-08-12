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


def parse_stop_actions(raw: Optional[str], length: int) -> List[Optional[dict]]:
    """`WayInfo.StopActions` JSON 문자열을 length 길이의 리스트로 정규화 (각 원소 dict|None).

    경유지 도착 상호작용: [{announceId, announceText, confirm, onTimeout} | null]
    파싱 실패·길이 부족은 None(상호작용 없음)으로 대체한다.
    """
    default: List[Optional[dict]] = [None] * length
    if not raw:
        return default
    try:
        parsed = json.loads(raw)
    except Exception:
        return default
    if not isinstance(parsed, list):
        return default
    out: List[Optional[dict]] = []
    for i in range(length):
        v = parsed[i] if i < len(parsed) else None
        out.append(v if isinstance(v, dict) else None)
    return out


def build_waypoints_from_places(
    places: Iterable[LocationInfo],
    wait_seconds: Optional[List[int]] = None,
    stop_actions: Optional[List[Optional[dict]]] = None,
) -> List[dict]:
    """장소 목록 → 웨이포인트 dict 목록.

    yaw 규칙:
    - 마지막 포인트: 저장된 Yaw 사용 (없으면 0.0)
    - 그 외: 다음 포인트를 향하는 방향으로 계산 (atan2)

    wait_seconds: 각 포인트 도착 후 대기(초). 미지정 시 모두 0.
    stop_actions: 각 포인트 도착 상호작용(발화·확인). 미지정 시 모두 None.
    """
    places = list(places)
    waits = wait_seconds or [0] * len(places)
    actions = stop_actions or [None] * len(places)
    waypoints = []
    for i, place in enumerate(places):
        x = place.LocationX
        y = place.LocationY
        next_place = places[i + 1] if i < len(places) - 1 else None
        # 다층 경로: 다음 포인트가 다른 맵이면 좌표계가 달라 atan2(다음 방향)가 무의미.
        # 이 경우(층 전환 경계) 저장된 Yaw를 사용한다. (실행기가 이 지점에서 맵 전환 처리)
        same_map_next = (
            next_place is not None and next_place.MapId == place.MapId
        )
        if same_map_next:
            yaw = math.atan2(next_place.LocationY - y, next_place.LocationX - x)
        else:
            yaw = place.Yaw or 0.0
        waypoints.append({
            "x": x,
            "y": y,
            "yaw": round(yaw, 3),
            "name": place.LacationName,
            "map_id": place.MapId,
            "floor_id": place.FloorId,
            "wait_seconds": waits[i] if i < len(waits) else 0,
            "stop_action": actions[i] if i < len(actions) else None,
        })
    return waypoints
