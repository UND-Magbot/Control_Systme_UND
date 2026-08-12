"""자동문 통과 트리거 — POI 근접 매칭 (E5 D3, 1차 방식).

경로 스키마(WayInfo.WayPoints 문자열)를 건드리지 않고 자동문 통과를 개시하기 위한
판정 로직. `WayPointItem.EdgeType='door'` 정규화(아키텍처 M4)로 대체될 때까지의 1차안이다.

오탐(문 근처를 지나가기만 해도 발동)을 막기 위해 **반경 + 진행 방향** 2중 게이트를 쓴다.
- 반경: 로봇이 진입 POI 로부터 `radius_m` 안에 있어야 한다.
- 방향: 로봇의 진행 방향이 반대편 POI 쪽을 향해야 한다(±`heading_tolerance_deg`).
문을 등지고 지나가거나 옆으로 스쳐 가는 경우는 발동하지 않는다.

표준 라이브러리만 사용한다(DB·로봇 의존 없음 → 단위 테스트 가능).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional

DEFAULT_RADIUS_M = 1.5
DEFAULT_HEADING_TOLERANCE_DEG = 70.0


@dataclass(frozen=True)
class Pose:
    x: float
    y: float
    yaw: float = 0.0            # rad, 맵 좌표계 기준 진행 방향


@dataclass(frozen=True)
class DoorGeometry:
    """트리거 판정에 필요한 최소 정보. DoorInfo + LocationInfo 좌표를 조립해 만든다."""
    door_id: int
    name: str
    map_id: int
    near: Pose                  # DoorInfo.NearLocationId 좌표
    far: Pose                   # DoorInfo.FarLocationId 좌표


@dataclass(frozen=True)
class DoorTrigger:
    door_id: int
    name: str
    reverse: bool               # True = Far→Near 방향으로 통과
    distance_m: float


def distance(a: Pose, b: Pose) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def angle_diff(a: float, b: float) -> float:
    """두 각(rad)의 최소 차이. 항상 0~pi."""
    return abs(math.atan2(math.sin(a - b), math.cos(a - b)))


def heading_toward(pose: Pose, target: Pose, tolerance_deg: float) -> bool:
    """로봇의 진행 방향(yaw)이 target 쪽을 향하는지. 같은 자리면 판정 불가로 False."""
    dx, dy = target.x - pose.x, target.y - pose.y
    if math.hypot(dx, dy) < 1e-6:
        return False
    return angle_diff(math.atan2(dy, dx), pose.yaw) <= math.radians(tolerance_deg)


def match_door(
    pose: Pose,
    map_id: int,
    doors: Iterable[DoorGeometry],
    radius_m: float = DEFAULT_RADIUS_M,
    heading_tolerance_deg: float = DEFAULT_HEADING_TOLERANCE_DEG,
) -> Optional[DoorTrigger]:
    """지금 통과를 개시해야 할 자동문. 없으면 None.

    양방향 통과를 두 POI 의 순서로 표현하므로, Near 쪽에서 잡히면 정방향,
    Far 쪽에서 잡히면 reverse=True 로 돌려준다.
    후보가 여럿이면 가장 가까운 진입점을 고른다.
    """
    best: Optional[DoorTrigger] = None
    for d in doors:
        if d.map_id != map_id:
            continue
        for entry, exit_, reverse in ((d.near, d.far, False), (d.far, d.near, True)):
            dist = distance(pose, entry)
            if dist > radius_m:
                continue
            if not heading_toward(pose, exit_, heading_tolerance_deg):
                continue
            if best is None or dist < best.distance_m:
                best = DoorTrigger(door_id=d.door_id, name=d.name, reverse=reverse, distance_m=dist)
    return best


def build_geometry(door: dict, places: dict[int, dict]) -> Optional[DoorGeometry]:
    """DoorInfo dict + {locationId: {LocationX, LocationY, Yaw}} → DoorGeometry.

    좌표가 없거나 미완료(complete=False) 자동문은 트리거 대상에서 제외한다 —
    등록이 덜 된 문 앞에서 로봇을 세우지 않는다.
    """
    near_id, far_id, map_id = door.get("nearLocationId"), door.get("farLocationId"), door.get("mapId")
    if not (near_id and far_id and map_id):
        return None
    near, far = places.get(near_id), places.get(far_id)
    if not near or not far:
        return None
    return DoorGeometry(
        door_id=door["id"],
        name=door.get("name", ""),
        map_id=map_id,
        near=Pose(float(near["LocationX"]), float(near["LocationY"]), float(near.get("Yaw") or 0.0)),
        far=Pose(float(far["LocationX"]), float(far["LocationY"]), float(far.get("Yaw") or 0.0)),
    )
