import os
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional

from app.Database.database import SessionLocal
from app.Database.models import UserInfo, RecordingInfo
from app.auth.dependencies import get_current_user, require_permission
from app.recording import service as rec_service
from app.recording import manager as rec_manager
from app.recording.schemas import RecordingStartRequest, RecordingStopRequest
from app.recording.service import to_absolute_path

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── 현재 녹화 세션 (/{record_id} 패턴보다 앞에 등록해야 함) ──
@router.get("/active")
def get_active_sessions(
    robot_id: Optional[int] = Query(None),
    current_user: UserInfo = Depends(require_permission("video")),
):
    from app.navigation.send_move import is_nav_active
    sessions = rec_manager.get_active_sessions(robot_id)
    return {
        "sessions": sessions,
        "is_navigating": is_nav_active(),
    }


# ── 녹화 목록 (GroupId 묶음) ──
@router.get("")
def list_recordings(
    robot_id: Optional[int] = Query(None),
    record_type: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("video")),
):
    return rec_service.get_recordings_grouped(
        db, robot_id=robot_id, record_type=record_type,
        start_date=start_date, end_date=end_date,
        page=page, size=size,
    )


# ── 가장 이른 녹화 날짜 ──
@router.get("/earliest-date")
def get_earliest_recording_date(
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("video")),
):
    return rec_service.get_earliest_recording_date(db)


# ── 영상 다운로드 (Content-Disposition: attachment) ──
@router.get("/download/{record_id}")
def download_recording(
    record_id: int,
    filename: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("video")),
):
    rec = rec_service.get_recording_by_id(db, record_id)
    if not rec or not rec.VideoPath:
        return JSONResponse({"error": "녹화를 찾을 수 없습니다"}, status_code=404)

    video_file = _find_segment_file(rec, db)
    if not video_file or not os.path.exists(video_file):
        return JSONResponse({"error": "영상 파일을 찾을 수 없습니다"}, status_code=404)

    download_name = filename or os.path.basename(video_file)
    from urllib.parse import quote
    encoded_name = quote(download_name)
    return FileResponse(
        video_file,
        media_type="video/mp4",
        filename=download_name,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}",
        },
    )


# ── 영상 스트리밍 (Range 지원) ──
@router.get("/{record_id}/stream")
def stream_recording(
    record_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("video")),
):
    rec = rec_service.get_recording_by_id(db, record_id)
    if not rec or not rec.VideoPath:
        return JSONResponse({"error": "녹화를 찾을 수 없습니다"}, status_code=404)

    # VideoPath는 디렉토리 — 해당 세그먼트 파일 찾기
    video_file = _find_segment_file(rec, db)
    if not video_file or not os.path.exists(video_file):
        return JSONResponse({"error": "영상 파일을 찾을 수 없습니다"}, status_code=404)

    file_size = os.path.getsize(video_file)
    range_header = request.headers.get("range")

    # Range 요청 처리 (브라우저 <video> 태그 탐색 지원)
    if range_header:
        start, end = _parse_range(range_header, file_size)
        length = end - start + 1

        def iter_file():
            with open(video_file, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(8192, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return StreamingResponse(
            iter_file(),
            status_code=206,
            media_type="video/mp4",
            headers={
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(length),
                "Content-Disposition": f'inline; filename="{os.path.basename(video_file)}"',
            },
        )

    # Range 없으면 전체 파일 반환
    return FileResponse(
        video_file,
        media_type="video/mp4",
        filename=os.path.basename(video_file),
    )


# ── 썸네일 ──
@router.get("/{record_id}/thumbnail")
def get_thumbnail(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("video")),
):
    rec = rec_service.get_recording_by_id(db, record_id)
    if not rec:
        return JSONResponse({"error": "썸네일을 찾을 수 없습니다"}, status_code=404)

    # 1) 기존 썸네일 파일이 있으면 반환
    if rec.ThumbnailPath:
        thumb_abs = to_absolute_path(rec.ThumbnailPath)
        if os.path.exists(thumb_abs):
            return FileResponse(thumb_abs, media_type="image/jpeg")

    # 2) 없으면 mp4에서 즉시 생성 시도
    video_file = _find_segment_file(rec, db)
    if video_file and os.path.exists(video_file):
        from app.recording.worker import generate_thumbnail
        from app.recording.service import to_relative_path
        thumb = generate_thumbnail(video_file)
        if thumb and os.path.exists(thumb):
            # DB에 저장 (다음 요청부터 캐시)
            rec.ThumbnailPath = to_relative_path(thumb)
            db.commit()
            return FileResponse(thumb, media_type="image/jpeg")

    return JSONResponse({"error": "썸네일을 찾을 수 없습니다"}, status_code=404)


# ── 수동 녹화 시작 ──
@router.post("/start")
def start_recording(
    req: RecordingStartRequest,
    current_user: UserInfo = Depends(require_permission("video")),
):
    result = rec_manager.start_manual_recording(req.robot_id, req.module_id)
    if "error" in result:
        return {"status": "error", "msg": result["error"]}
    return {"status": "ok", "group_id": result.get("group_id")}


# ── ���동 녹화 중지 ──
@router.post("/stop")
def stop_recording(
    req: RecordingStopRequest,
    current_user: UserInfo = Depends(require_permission("video")),
):
    result = rec_manager.stop_manual_recording(req.robot_id, req.module_id)
    if "error" in result:
        return {"status": "error", "msg": result["error"]}
    return {"status": "ok"}


# ── 녹화 삭제 (soft delete) ──
@router.delete("/{record_id}")
def delete_recording(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("video")),
):
    rec = rec_service.get_recording_by_id(db, record_id)
    if not rec:
        return {"status": "error", "msg": "녹화를 찾을 수 없습니다"}
    rec_service.soft_delete_recording(db, record_id)
    return {"status": "ok"}


# ── 그룹 일괄 삭제 (soft delete) ──
@router.post("/delete-groups")
def delete_groups(
    body: dict,
    db: Session = Depends(get_db),
    current_user: UserInfo = Depends(require_permission("video")),
):
    group_ids = body.get("group_ids", [])
    if not group_ids:
        return {"status": "error", "msg": "삭제할 항목이 없습니다"}

    deleted = rec_service.soft_delete_by_groups(db, group_ids)
    return {"status": "ok", "deleted": deleted}


# ── 헬퍼 ──
def _find_segment_file(rec: RecordingInfo, db: Session = None) -> Optional[str]:
    """DB 레코드에서 실제 세그먼트 MP4 파일 경로 찾기"""
    if not rec.VideoPath:
        return None

    video_dir = to_absolute_path(rec.VideoPath)

    # VideoPath가 파일이면 그대로 반환
    if os.path.isfile(video_dir):
        return video_dir

    # VideoPath가 디렉토리면 — 같은 카메라의 세그먼트 파일 중 순서로 매칭
    if os.path.isdir(video_dir):
        files = sorted([
            f for f in os.listdir(video_dir)
            if f.endswith(".mp4") and f"cam{rec.ModuleId}" in f
        ])
        if not files:
            return None

        # 같은 GroupId + ModuleId 내에서 이 레코드가 몇 번째 세그먼트인지 계산
        seg_index = 0
        if db:
            siblings = (
                db.query(RecordingInfo)
                .filter(
                    RecordingInfo.GroupId == rec.GroupId,
                    RecordingInfo.ModuleId == rec.ModuleId,
                    RecordingInfo.DeletedAt.is_(None),
                )
                .order_by(RecordingInfo.RecordStart)
                .all()
            )
            for i, sib in enumerate(siblings):
                if sib.id == rec.id:
                    seg_index = i
                    break

        if seg_index < len(files):
            return os.path.join(video_dir, files[seg_index])
        return os.path.join(video_dir, files[-1])

    return None


def _parse_range(range_header: str, file_size: int) -> tuple[int, int]:
    """Range 헤더 파싱 → (start, end)"""
    range_spec = range_header.replace("bytes=", "").strip()
    parts = range_spec.split("-")
    start = int(parts[0]) if parts[0] else 0
    end = int(parts[1]) if parts[1] else file_size - 1
    end = min(end, file_size - 1)
    return start, end
