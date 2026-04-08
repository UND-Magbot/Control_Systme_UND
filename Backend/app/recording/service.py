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
        RecordingInfo.Status != "error",
    )
    if robot_id:
        base = base.filter(RecordingInfo.RobotId == robot_id)
    if record_type:
        base = base.filter(RecordingInfo.RecordType == record_type)
    if start_date:
        base = base.filter(RecordingInfo.RecordStart >= start_date)
    if end_date:
        base = base.filter(RecordingInfo.RecordStart <= end_date)

    # 그룹별 고유 GroupId 목록
    group_query = (
        base.with_entities(RecordingInfo.GroupId)
        .distinct()
        .order_by(desc(sqlfunc.max(RecordingInfo.RecordStart)))
    )

    # 전체 그룹 수 (총 카운트)
    all_groups = group_query.all()
    total = len(all_groups)

    # 페이지네이션
    group_ids = [g[0] for g in all_groups[(page - 1) * size : page * size]]

    # 2) 그룹별 세그먼트 + 조인 정보
    results = []
    for gid in group_ids:
        segments = (
            db.query(RecordingInfo)
            .filter(RecordingInfo.GroupId == gid, RecordingInfo.DeletedAt.is_(None))
            .order_by(RecordingInfo.RecordStart)
            .all()
        )
        if not segments:
            continue

        first = segments[0]
        last = segments[-1]

        # 로봇 이름
        robot = db.query(RobotInfo).filter(RobotInfo.id == first.RobotId).first()
        robot_name = robot.RobotName if robot else f"Robot-{first.RobotId}"

        # 카메라 라벨
        module = db.query(RobotModule).filter(RobotModule.id == first.ModuleId).first()
        camera_label = module.Label if module else f"cam-{first.ModuleId}"

        # 스케줄 작업명
        work_name = None
        if first.ScheduleId:
            schedule = db.query(ScheduleInfo).filter(ScheduleInfo.id == first.ScheduleId).first()
            if schedule:
                work_name = schedule.WorkName

        # 총 녹화 시간 계산
        total_sec = 0
        for seg in segments:
            if seg.RecordEnd and seg.RecordStart:
                total_sec += int((seg.RecordEnd - seg.RecordStart).total_seconds())

        # 녹화 유형 표시명
        type_label = "자동" if first.RecordType == "auto" else "수동"

        # 첫 세그먼트 썸네일
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

        # 상태 + 에러 사유
        status = first.Status
        error_reason = first.ErrorReason if status == "error" else None

        results.append({
            "group_id": gid,
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
    """서버 시작 시 Status='recording' 고아 레코드 → 'error'"""
    orphans = db.query(RecordingInfo).filter(RecordingInfo.Status == "recording").all()
    count = 0
    for rec in orphans:
        rec.Status = "error"
        rec.RecordEnd = datetime.now()
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


def build_rtsp_url(db: Session, module: RobotModule) -> Optional[str]:
    """모듈에서 RTSP URL 생성"""
    ci = module.camera_info
    if not ci or ci.StreamType != "rtsp":
        return None

    robot = db.query(RobotInfo).filter(RobotInfo.id == module.RobotId).first()
    ip = ci.CameraIP or (robot.RobotIP if robot else None)
    if not ip:
        return None

    return f"rtsp://{ip}:{ci.Port}{ci.Path}"
