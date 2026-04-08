from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── 요청 ──
class RecordingStartRequest(BaseModel):
    robot_id: int
    module_id: int


class RecordingStopRequest(BaseModel):
    robot_id: int
    module_id: int


# ── 응답: 개별 세그먼트 ──
class SegmentItem(BaseModel):
    id: int
    start: str               # "HH:MM:SS"
    duration_sec: int
    stream_url: str

    class Config:
        from_attributes = True


# ── 응답: 그룹 묶음 (VideoList용) ──
class RecordingGroupItem(BaseModel):
    group_id: str
    robot_id: int
    robot_name: str
    camera_label: str
    record_type: str           # "자동" | "수동"
    work_name: Optional[str]   # ScheduleInfo.WorkName (수동이면 None)
    record_start: datetime
    record_end: Optional[datetime]
    total_duration_sec: int
    segment_count: int
    thumbnail_url: Optional[str]
    segments: List[SegmentItem]

    class Config:
        from_attributes = True


# ── 응답: 녹화 목록 (페이지네이션) ──
class RecordingListResponse(BaseModel):
    items: List[RecordingGroupItem]
    total: int
    page: int
    size: int


# ── 응답: 활성 세션 ──
class ActiveSessionItem(BaseModel):
    module_id: int
    record_type: str           # "auto" | "manual"
    group_id: str
    started_at: str


class ActiveSessionsResponse(BaseModel):
    sessions: List[ActiveSessionItem]
    is_navigating: bool
