"""위험지역(Danger Zone) CRUD — `location_info` 재사용.

한 위험지역 = 여러 꼭짓점 행 (`Category='danger'`, 같은 `LacationName`/`MapId`).
꼭짓점 순서는 `id` ASC.
"""

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.database.models import LocationInfo, UserInfo, RouteInfo, WayInfo, ScheduleInfo
from app.auth.dependencies import require_any_permission, get_current_user
from app.auth.audit import write_audit, get_client_ip
from app.common.geometry import point_in_polygon, segment_intersects_polygon

from app.database.routes import database, get_db


DANGER_CATEGORY = "danger"
MIN_VERTICES = 3


def load_zone_polygons(db: Session, map_id: int) -> list[tuple[str, list[tuple[float, float]]]]:
    """특정 맵의 위험지역 폴리곤들을 `[(name, [(x, y), ...]), ...]`로 반환.
    꼭짓점 3개 미만 그룹은 제외 (유효하지 않은 zone).
    """
    rows = (
        db.query(LocationInfo)
        .filter(
            LocationInfo.MapId == map_id,
            LocationInfo.Category == DANGER_CATEGORY,
        )
        .all()
    )
    grouped: dict[str, list[LocationInfo]] = {}
    for r in rows:
        grouped.setdefault(r.LacationName, []).append(r)
    polys: list[tuple[str, list[tuple[float, float]]]] = []
    for name, verts in grouped.items():
        verts_sorted = sorted(verts, key=lambda v: v.id)
        if len(verts_sorted) < MIN_VERTICES:
            continue
        polys.append((name, [(v.LocationX, v.LocationY) for v in verts_sorted]))
    return polys


class DangerZonePoint(BaseModel):
    x: float
    y: float


class DangerZoneCreateReq(BaseModel):
    MapId: int
    ZoneName: str = Field(min_length=1, max_length=100)
    points: list[DangerZonePoint]
    Description: str | None = None
    force: bool = False  # 충돌 cascade 허용 여부


class DangerZoneUpdateNameReq(BaseModel):
    NewZoneName: str = Field(min_length=1, max_length=100)
    Description: str | None = None


def detect_zone_conflicts(db: Session, map_id: int, polygon: list[tuple[float, float]]) -> dict:
    """맵의 POI / RouteInfo / WayInfo 중 폴리곤과 충돌하는 항목 수집.

    반환 구조:
      {
        "poi_ids": [...], "poi_names": [...],
        "route_ids": [...],
        "way_ids": [...], "way_names": [...],
        "in_progress_schedules": [{"schedule_id": ..., "WorkName": ..., "WayName": ...}]
      }
    """
    if len(polygon) < MIN_VERTICES:
        return {"poi_ids": [], "poi_names": [], "route_ids": [],
                "way_ids": [], "way_names": [], "in_progress_schedules": []}

    # POI 조회 (위험지역 꼭짓점 제외)
    pois = (
        db.query(LocationInfo)
        .filter(
            LocationInfo.MapId == map_id,
            (LocationInfo.Category != DANGER_CATEGORY) | (LocationInfo.Category.is_(None)),
        )
        .all()
    )

    poi_ids: list[int] = []
    poi_names_inside: set[str] = set()
    poi_coord: dict[str, tuple[float, float]] = {}
    for p in pois:
        coord = (p.LocationX, p.LocationY)
        poi_coord[p.LacationName] = coord
        if point_in_polygon(coord, polygon):
            poi_ids.append(p.id)
            poi_names_inside.add(p.LacationName)

    # RouteInfo: 시작/끝이 내부면 포함, 선분 교차도 포함
    routes = db.query(RouteInfo).filter(RouteInfo.MapId == map_id).all()
    route_ids: list[int] = []
    for r in routes:
        a = poi_coord.get(r.StartPlaceName)
        b = poi_coord.get(r.EndPlaceName)
        if not a or not b:
            continue
        if (
            r.StartPlaceName in poi_names_inside
            or r.EndPlaceName in poi_names_inside
            or segment_intersects_polygon(a, b, polygon)
        ):
            route_ids.append(r.id)

    # WayInfo: 사용하는 POI 이름이 inside 에 있거나, 인접 쌍 선분이 교차하면 포함
    ways = db.query(WayInfo).all()
    way_ids: list[int] = []
    way_names: list[str] = []
    for w in ways:
        names = [n.strip() for n in (w.WayPoints or "").split(" - ") if n.strip()]
        if not names:
            continue

        # indirect: POI 포함
        if any(n in poi_names_inside for n in names):
            way_ids.append(w.id)
            way_names.append(w.WayName)
            continue

        # direct: 인접 쌍 선분 교차 (해당 맵의 POI 좌표만 사용 가능)
        crossed = False
        for i in range(len(names) - 1):
            a = poi_coord.get(names[i])
            b = poi_coord.get(names[i + 1])
            if not a or not b:
                continue
            if segment_intersects_polygon(a, b, polygon):
                crossed = True
                break
        if crossed:
            way_ids.append(w.id)
            way_names.append(w.WayName)

    # 진행중 스케줄 — cascade 대상 way_names 를 쓰는 스케줄
    in_progress: list[dict] = []
    if way_names:
        running = (
            db.query(ScheduleInfo)
            .filter(
                ScheduleInfo.TaskStatus == "진행중",
                ScheduleInfo.WayName.in_(way_names),
            )
            .all()
        )
        in_progress = [
            {"schedule_id": s.id, "WorkName": s.WorkName, "WayName": s.WayName}
            for s in running
        ]

    return {
        "poi_ids": poi_ids,
        "poi_names": list(poi_names_inside),
        "route_ids": route_ids,
        "way_ids": way_ids,
        "way_names": way_names,
        "in_progress_schedules": in_progress,
    }


def _group_zones(rows: list[LocationInfo]) -> list[dict]:
    """같은 (MapId, LacationName)끼리 묶어서 zone 리스트로 반환."""
    grouped: dict[tuple[int, str], list[LocationInfo]] = {}
    for r in rows:
        key = (r.MapId, r.LacationName)
        grouped.setdefault(key, []).append(r)

    zones: list[dict] = []
    for (map_id, name), verts in grouped.items():
        verts_sorted = sorted(verts, key=lambda v: v.id)
        if len(verts_sorted) < MIN_VERTICES:
            # 꼭짓점 수 부족(과거 단일 점 잔재 등)은 zone으로 간주하지 않음
            continue
        zones.append({
            "MapId": map_id,
            "ZoneName": name,
            "Description": verts_sorted[0].Imformation,
            "points": [
                {"x": v.LocationX, "y": v.LocationY} for v in verts_sorted
            ],
            "vertex_ids": [v.id for v in verts_sorted],
        })
    return zones


@database.get("/danger-zones")
def get_danger_zones(
    map_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(get_current_user),
):
    q = db.query(LocationInfo).filter(LocationInfo.Category == DANGER_CATEGORY)
    if map_id is not None:
        q = q.filter(LocationInfo.MapId == map_id)
    rows = q.all()
    return _group_zones(rows)


@database.post("/danger-zones")
def create_danger_zone(
    req: DangerZoneCreateReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("map-edit")),
):
    if len(req.points) < MIN_VERTICES:
        raise HTTPException(status_code=400, detail=f"위험지역은 꼭짓점 {MIN_VERTICES}개 이상 필요합니다")

    # 같은 맵 내 이름 중복 검사 (cascade 검사 이전에 수행)
    exists = (
        db.query(LocationInfo)
        .filter(
            LocationInfo.MapId == req.MapId,
            LocationInfo.LacationName == req.ZoneName,
            LocationInfo.Category == DANGER_CATEGORY,
        )
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="같은 맵에 동일한 이름의 위험지역이 이미 존재합니다")

    # 충돌 감지 (저장 직전 최신 상태로)
    polygon: list[tuple[float, float]] = [(p.x, p.y) for p in req.points]
    conflicts = detect_zone_conflicts(db, req.MapId, polygon)

    # 진행중 스케줄 하드 블록 (force=True 로도 우회 불가)
    if conflicts["in_progress_schedules"]:
        raise HTTPException(
            status_code=409,
            detail={
                "type": "zone_blocked_by_in_progress",
                "in_progress_schedules": conflicts["in_progress_schedules"],
            },
        )

    has_conflicts = bool(
        conflicts["poi_ids"] or conflicts["route_ids"] or conflicts["way_ids"]
    )

    # 충돌 있는데 force=False → 클라이언트가 cascade 모달 표시하도록 409
    if has_conflicts and not req.force:
        raise HTTPException(
            status_code=409,
            detail={
                "type": "zone_conflicts",
                "conflicts": {
                    "poi_ids": conflicts["poi_ids"],
                    "poi_names": conflicts["poi_names"],
                    "route_ids": conflicts["route_ids"],
                    "way_ids": conflicts["way_ids"],
                    "way_names": conflicts["way_names"],
                },
            },
        )

    # 단일 트랜잭션: cascade 삭제 + zone INSERT
    try:
        # POI 삭제 (danger 카테고리 제외 — 이미 감지 단계에서 필터됨)
        if conflicts["poi_ids"]:
            db.query(LocationInfo).filter(
                LocationInfo.id.in_(conflicts["poi_ids"]),
                (LocationInfo.Category != DANGER_CATEGORY) | (LocationInfo.Category.is_(None)),
            ).delete(synchronize_session=False)

        # RouteInfo 삭제
        if conflicts["route_ids"]:
            db.query(RouteInfo).filter(RouteInfo.id.in_(conflicts["route_ids"])).delete(
                synchronize_session=False,
            )

        # WayInfo 삭제
        if conflicts["way_ids"]:
            db.query(WayInfo).filter(WayInfo.id.in_(conflicts["way_ids"])).delete(
                synchronize_session=False,
            )

        # Zone 꼭짓점 INSERT
        vertex_ids: list[int] = []
        for pt in req.points:
            row = LocationInfo(
                UserId=current_user.id,
                RobotName="",
                LacationName=req.ZoneName,
                FloorId=None,
                LocationX=pt.x,
                LocationY=pt.y,
                Yaw=0.0,
                MapId=req.MapId,
                Category=DANGER_CATEGORY,
                Imformation=req.Description,
            )
            db.add(row)
            db.flush()
            vertex_ids.append(row.id)

        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="위험지역 저장 실패 (변경사항 없음)")

    cascade_summary = (
        f" cascade: POI {len(conflicts['poi_ids'])}개, "
        f"구간 {len(conflicts['route_ids'])}개, 경로 {len(conflicts['way_ids'])}개"
        if has_conflicts
        else ""
    )
    write_audit(
        db, current_user.id, "danger_zone_created", "place", vertex_ids[0],
        detail=f"위험지역: {req.ZoneName} (MapId={req.MapId}, 꼭짓점 {len(req.points)}개){cascade_summary}",
        ip_address=get_client_ip(request),
    )

    return {
        "MapId": req.MapId,
        "ZoneName": req.ZoneName,
        "Description": req.Description,
        "points": [{"x": p.x, "y": p.y} for p in req.points],
        "vertex_ids": vertex_ids,
        "cascaded": {
            "poi_ids": conflicts["poi_ids"],
            "route_ids": conflicts["route_ids"],
            "way_ids": conflicts["way_ids"],
            "way_names": conflicts["way_names"],
        },
    }


@database.delete("/danger-zones")
def delete_danger_zone(
    map_id: int,
    name: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("map-edit")),
):
    rows = (
        db.query(LocationInfo)
        .filter(
            LocationInfo.MapId == map_id,
            LocationInfo.LacationName == name,
            LocationInfo.Category == DANGER_CATEGORY,
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="위험지역을 찾을 수 없습니다")

    count = len(rows)
    for r in rows:
        db.delete(r)
    db.commit()

    write_audit(
        db, current_user.id, "danger_zone_deleted", "place", rows[0].id,
        detail=f"위험지역: {name} (MapId={map_id}, 꼭짓점 {count}개)",
        ip_address=get_client_ip(request),
    )
    return {"status": "deleted", "count": count}


@database.put("/danger-zones/{map_id}/{name}")
def rename_danger_zone(
    map_id: int,
    name: str,
    req: DangerZoneUpdateNameReq,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_any_permission("map-edit")),
):
    rows = (
        db.query(LocationInfo)
        .filter(
            LocationInfo.MapId == map_id,
            LocationInfo.LacationName == name,
            LocationInfo.Category == DANGER_CATEGORY,
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="위험지역을 찾을 수 없습니다")

    if req.NewZoneName != name:
        # 새 이름 중복 검사
        dup = (
            db.query(LocationInfo)
            .filter(
                LocationInfo.MapId == map_id,
                LocationInfo.LacationName == req.NewZoneName,
                LocationInfo.Category == DANGER_CATEGORY,
            )
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail="같은 맵에 동일한 이름의 위험지역이 이미 존재합니다")

    for r in rows:
        r.LacationName = req.NewZoneName
        r.Imformation = req.Description
    db.commit()

    write_audit(
        db, current_user.id, "danger_zone_updated", "place", rows[0].id,
        detail=f"위험지역: {name} → {req.NewZoneName} (MapId={map_id})",
        ip_address=get_client_ip(request),
    )
    return {"status": "ok", "count": len(rows)}
