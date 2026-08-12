"""자동문 POI 근접 트리거 (E5 D3) 검증.

오탐 억제가 목적이다 — 문 근처를 '지나가기만' 해도 통과가 개시되면
불필요한 개폐·정지가 생긴다. 반경과 진행 방향 2중 게이트를 확인한다.
"""
import math

import door_trigger as dt
from door_trigger import DoorGeometry, Pose, build_geometry, match_door

# 문: near(0,0) → far(2,0). +x 방향이 정방향 통과.
DOOR = DoorGeometry(door_id=7, name="본관 1층 정문", map_id=12,
                    near=Pose(0.0, 0.0), far=Pose(2.0, 0.0))
EAST, WEST = 0.0, math.pi
NORTH = math.pi / 2


def test_forward_pass_triggers():
    hit = match_door(Pose(-0.5, 0.0, EAST), 12, [DOOR])
    assert hit and hit.door_id == 7 and hit.reverse is False


def test_reverse_pass_detected_from_far_side():
    # 반대편에서 진입 → 같은 문, 방향만 뒤집힌다(양방향을 두 점 순서로 표현).
    hit = match_door(Pose(2.5, 0.0, WEST), 12, [DOOR])
    assert hit and hit.reverse is True


def test_out_of_radius_does_not_trigger():
    assert match_door(Pose(-5.0, 0.0, EAST), 12, [DOOR]) is None


def test_passing_by_sideways_does_not_trigger():
    # 문 바로 옆에 있지만 진행 방향이 문을 가로지르지 않는다 → 발동 금지.
    assert match_door(Pose(0.0, 0.4, NORTH), 12, [DOOR]) is None


def test_facing_away_does_not_trigger():
    # 진입점 반경 안이지만 문을 등지고 간다.
    assert match_door(Pose(-0.5, 0.0, WEST), 12, [DOOR]) is None


def test_other_map_ignored():
    assert match_door(Pose(-0.5, 0.0, EAST), 99, [DOOR]) is None


def test_nearest_entry_wins():
    far_door = DoorGeometry(door_id=8, name="후문", map_id=12,
                            near=Pose(-1.2, 0.0), far=Pose(-3.0, 0.0))
    # (-1.0,0) 에서 동쪽 진행: DOOR.near(거리 1.0) 는 방향 일치,
    # far_door.near(거리 0.2) 는 출구가 뒤쪽이라 방향 불일치 → DOOR 가 선택된다.
    hit = match_door(Pose(-1.0, 0.0, EAST), 12, [far_door, DOOR])
    assert hit and hit.door_id == 7


def test_heading_tolerance_is_configurable():
    # 45도 비스듬히 진입 — 기본(70도)은 통과, 30도로 좁히면 걸러진다.
    pose = Pose(-0.5, -0.5, math.radians(45))
    assert match_door(pose, 12, [DOOR]) is not None
    assert match_door(pose, 12, [DOOR], heading_tolerance_deg=15) is None


# ─────────────────────── 지오메트리 조립 ───────────────────────
PLACES = {
    10: {"LocationX": 0.0, "LocationY": 0.0, "Yaw": 0.0},
    11: {"LocationX": 2.0, "LocationY": 0.0, "Yaw": 0.0},
}


def test_build_geometry_ok():
    door = {"id": 7, "name": "정문", "mapId": 12, "nearLocationId": 10, "farLocationId": 11}
    g = build_geometry(door, PLACES)
    assert g and g.map_id == 12 and g.far.x == 2.0


def test_incomplete_door_is_not_triggerable():
    # POI 가 덜 지정된 문 앞에서 로봇을 세우지 않는다.
    door = {"id": 7, "name": "정문", "mapId": 12, "nearLocationId": 10, "farLocationId": None}
    assert build_geometry(door, PLACES) is None


def test_missing_place_row_is_not_triggerable():
    door = {"id": 7, "name": "정문", "mapId": 12, "nearLocationId": 10, "farLocationId": 999}
    assert build_geometry(door, PLACES) is None
