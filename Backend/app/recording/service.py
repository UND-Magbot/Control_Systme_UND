from sqlalchemy.orm import Session
from sqlalchemy import desc, func as sqlfunc
from datetime import datetime
from typing import Optional, List

from app.Database.models import RecordingInfo, RobotModule, ModuleCameraInfo, RobotInfo, ScheduleInfo


def create_recording(
    db: Session,
    robot_id: int,
    module_id: int,
    group_id: str,
    record_type: str,
    video_path: str,
    schedule_id: Optional[int] = None,
) -> RecordingInfo:
    rec = RecordingInfo(
        RobotId=robot_id,
        ModuleId=module_id,
        ScheduleId=schedule_id,
        GroupId=group_id,
        RecordType=record_type,
        VideoPath=video_path,
        Status="recording",
        RecordStart=datetime.now(),
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def complete_recording(
    db: Session,
    record_id: int,
    video_size: Optional[int] = None,
    thumbnail_path: Optional[str] = None,
):
    rec = db.query(RecordingInfo).filter(RecordingInfo.id == record_id).first()
    if not rec:
        return
    rec.Status = "completed"
    rec.RecordEnd = datetime.now()
    if video_size is not None:
        rec.VideoSize = video_size
    if thumbnail_path:
        rec.ThumbnailPath = thumbnail_path
    db.commit()


def error_recording(db: Session, record_id: int, reason: str = None):
    rec = db.query(RecordingInfo).filter(RecordingInfo.id == record_id).first()
    if not rec:
        return
    rec.Status = "error"
    rec.RecordEnd = datetime.now()
    if reason:
        rec.ErrorReason = reason[:200]  # 컬럼 길이 제한
    db.commit()


def get_recording_by_id(db: Session, record_id: int) -> Optional[RecordingInfo]:
    return (
        db.query(RecordingInfo)
        .filter(RecordingInfo.id == record_id, RecordingInfo.DeletedAt.is_(None))
        .first()
    )


def get_recordings_grouped(
    db: Session,
    robot_id: Optional[int] = None,
    record_type: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    page: int = 1,
    size: int = 20,
):
    """GroupId 기준으로 묶어서 녹화 목록 반환 (error 상태 제외)"""
    # 1) 그룹별 요약 서브쿼리
    base = db.query(RecordingInfo).filter(
        RecordingInfo.DeletedAt.is_(None),
        RecordingInfo.Status == "completed",
    )
    if robot_id:
        base = base.filter(RecordingInfo.RobotId == robot_id)
    if record_type:
        base = base.filter(RecordingInfo.RecordType == record_type)
    if start_date:
        base = base.filter(RecordingInfo.RecordStart >= start_date)
    if end_date:
        # "2026-04-08" → 해당 날짜 끝(23:59:59)까지 포함
        end_val = end_date.strip()
        if len(end_val) == 10:  # YYYY-MM-DD
            end_val += " 23:59:59"
        base = base.filter(RecordingInfo.RecordStart <= end_val)

    # 카메라별로 분리하여 그룹핑 (GroupId + ModuleId)
    group_query = (
        base.with_entities(RecordingInfo.GroupId, RecordingInfo.ModuleId)
        .group_by(RecordingInfo.GroupId, RecordingInfo.ModuleId)
        .order_by(desc(sqlfunc.max(RecordingInfo.RecordStart)))
    )

    # 전체 그룹 수 (총 카운트)
    all_groups = group_query.all()
    total = len(all_groups)

    # 페이지네이션
    page_groups = all_groups[(page - 1) * size : page * size]
    group_keys = [(g[0], g[1]) for g in page_groups]  # (GroupId, ModuleId)

    if not group_keys:
        return {"items": [], "total": total, "page": page, "size": size}

    # 2) 해당 페이지의 세그먼트를 한 번에 조회
    gid_set = set(gk[0] for gk in group_keys)
    all_segments = (
        db.query(RecordingInfo)
        .filter(RecordingInfo.GroupId.in_(gid_set), RecordingInfo.DeletedAt.is_(None),
                RecordingInfo.Status != "error")
        .order_by(RecordingInfo.RecordStart)
        .all()
    )

    # (GroupId, ModuleId)별로 세그먼트 분류
    segments_by_key: dict[tuple, list] = {}
    for seg in all_segments:
        k = (seg.GroupId, seg.ModuleId)
        segments_by_key.setdefault(k, []).append(seg)

    # 벌크 조회를 위한 ID 수집
    robot_ids = set()
    module_ids = set()
    schedule_ids = set()
    for k, segs in segments_by_key.items():
        if segs:
            first = segs[0]
            robot_ids.add(first.RobotId)
            module_ids.add(first.ModuleId)
            if first.ScheduleId:
                schedule_ids.add(first.ScheduleId)

    # 벌크 조회 (N+1 → 3쿼리)
    robots = {r.id: r for r in db.query(RobotInfo).filter(RobotInfo.id.in_(robot_ids)).all()} if robot_ids else {}
    modules_map = {m.id: m for m in db.query(RobotModule).filter(RobotModule.id.in_(module_ids)).all()} if module_ids else {}
    schedules = {s.id: s for s in db.query(ScheduleInfo).filter(ScheduleInfo.id.in_(schedule_ids)).all()} if schedule_ids else {}

    # 3) 카메라별 결과 조립
    results = []
    for gk in group_keys:
        segments = segments_by_key.get(gk, [])
        if not segments:
            continue

        first = segments[0]
        last = segments[-1]

        # 로봇 이름
        robot = robots.get(first.RobotId)
        robot_name = robot.RobotName if robot else f"Robot-{first.RobotId}"

        # 카메라 라벨
        module = modules_map.get(first.ModuleId)
        camera_label = module.Label if module else f"cam-{first.ModuleId}"

        # 스케줄 작업명
        work_name = None
        if first.ScheduleId:
            schedule = schedules.get(first.ScheduleId)
            if schedule:
                work_name = schedule.WorkName

        # 총 녹화 시간
        total_sec = 0
        for seg in segments:
            if seg.RecordEnd and seg.RecordStart:
                total_sec += int((seg.RecordEnd - seg.RecordStart).total_seconds())

        type_label = "자동" if first.RecordType == "auto" else "수동"

        thumbnail_url = None
        if first.ThumbnailPath:
            thumbnail_url = f"/api/recordings/{first.id}/thumbnail"

        seg_items = []
        for seg in segments:
            dur = 0
            if seg.RecordEnd and seg.RecordStart:
                dur = int((seg.RecordEnd - seg.RecordStart).total_seconds())
            seg_items.append({
                "id": seg.id,
                "start": seg.RecordStart.strftime("%H:%M:%S") if seg.RecordStart else "",
                "duration_sec": dur,
                "stream_url": f"/api/recordings/{seg.id}/stream",
            })

        status = first.Status
        error_reason = first.ErrorReason if status == "error" else None

        results.append({
            "group_id": f"{gk[0]}_{gk[1]}",  # GroupId_ModuleId (카메라별 고유키)
            "robot_id": first.RobotId,
            "robot_name": robot_name,
            "camera_label": camera_label,
            "record_type": type_label,
            "work_name": work_name,
            "record_start": first.RecordStart,
            "record_end": last.RecordEnd,
            "total_duration_sec": total_sec,
            "segment_count": len(segments),
            "thumbnail_url": thumbnail_url,
            "status": status,
            "error_reason": error_reason,
            "segments": seg_items,
        })

    return {"items": results, "total": total, "page": page, "size": size}


def soft_delete_recording(db: Session, record_id: int):
    rec = db.query(RecordingInfo).filter(RecordingInfo.id == record_id).first()
    if rec:
        rec.DeletedAt = datetime.now()
        db.commit()


def soft_delete_by_groups(db: Session, group_ids: List[str]) -> int:
    """GroupId 목록으로 일괄 soft delete"""
    now = datetime.now()
    records = (
        db.query(RecordingInfo)
        .filter(
            RecordingInfo.GroupId.in_(group_ids),
            RecordingInfo.DeletedAt.is_(None),
        )
        .all()
    )
    for rec in records:
        rec.DeletedAt = now
    db.commit()
    return len(records)


def cleanup_orphaned(db: Session) -> int:
    """서버 시작 시 비정상 레코드 정리:
    1) Status='recording' 고아 → 'error'
    2) Status='completed'인데 실제 파일 없음 → 'error'
    """
    import os
    now = datetime.now()
    count = 0

    # 1) recording 상태 고아
    orphans = db.query(RecordingInfo).filter(RecordingInfo.Status == "recording").all()
    for rec in orphans:
        rec.Status = "error"
        rec.ErrorReason = "서버 재시작 시 녹화 중이던 세션 (고아)"
        rec.RecordEnd = now
        count += 1

    # 2) completed인데 파일 없는 레코드
    completed = db.query(RecordingInfo).filter(
        RecordingInfo.Status == "completed",
        RecordingInfo.DeletedAt.is_(None),
    ).all()
    for rec in completed:
        has_file = False
        if rec.VideoPath and os.path.isdir(rec.VideoPath):
            mp4s = [f for f in os.listdir(rec.VideoPath)
                    if f.endswith(".mp4") and f"cam{rec.ModuleId}" in f]
            has_file = any(os.path.getsize(os.path.join(rec.VideoPath, f)) > 0 for f in mp4s)
        if not has_file:
            rec.Status = "error"
            rec.ErrorReason = "녹화 파일 미존재 (서버 시작 시 정리)"
            count += 1

    if count > 0:
        db.commit()
    return count


def get_active_camera_modules(db: Session, robot_id: int):
    """로봇의 활성 RTSP 카메라 모듈 목록 반환"""
    modules = (
        db.query(RobotModule)
        .join(ModuleCameraInfo, RobotModule.id == ModuleCameraInfo.ModuleId)
        .filter(
            RobotModule.RobotId == robot_id,
            RobotModule.ModuleType == "camera",
            RobotModule.IsActive == 1,
            ModuleCameraInfo.StreamType == "rtsp",
        )
        .all()
    )
    return modules


def build_rtsp_url(db: Session, module: RobotModule, robot: RobotInfo = None) -> Optional[str]:
    """모듈에서 RTSP URL 생성. robot 객체를 전달하면 DB 재조회를 생략한다."""
    ci = module.camera_info
    if not ci or ci.StreamType != "rtsp":
        return None

    if robot is None:
        robot = db.query(RobotInfo).filter(RobotInfo.id == module.RobotId).first()
    ip = ci.CameraIP or (robot.RobotIP if robot else None)
    if not ip:
        return None

    return f"rtsp://{ip}:{ci.Port}{ci.Path}"
