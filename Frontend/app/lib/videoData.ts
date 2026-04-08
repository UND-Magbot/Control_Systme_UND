import type { VideoItem } from "@/app/type";
import { apiFetch } from "@/app/lib/api";
import { API_BASE } from "@/app/config";

/**
 * 녹화 목록을 API에서 가져와 VideoItem[] 형태로 반환
 * Mock 데이터 대신 실제 녹화 API 호출
 */
export default async function getVideoInfo(params?: {
  robot_id?: number;
  record_type?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  size?: number;
}): Promise<{ items: VideoItem[]; total: number; page: number; size: number }> {
  try {
    const query = new URLSearchParams();
    if (params?.robot_id) query.set("robot_id", String(params.robot_id));
    if (params?.record_type) query.set("record_type", params.record_type);
    if (params?.start_date) query.set("start_date", params.start_date);
    if (params?.end_date) query.set("end_date", params.end_date);
    query.set("page", String(params?.page ?? 1));
    query.set("size", String(params?.size ?? 20));

    const res = await apiFetch(`/api/recordings?${query.toString()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const items: VideoItem[] = (data.items || []).map((group: any) => {
      const totalSec = group.total_duration_sec || 0;
      const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
      const ss = String(totalSec % 60).padStart(2, "0");

      return {
        // 기존 필드 호환
        id: group.segments?.[0]?.id ?? 0,
        robotNo: group.robot_name || "",
        cameraNo: group.camera_label || "",
        cameraType: group.record_type || "",
        filename: `${group.robot_name}_${group.camera_label}`,
        contentType: "video/mp4",
        data: "",
        videoTime: `${mm}:${ss}`,
        date: group.record_start || "",
        // 녹화 API 확장 필드
        group_id: group.group_id,
        robot_name: group.robot_name,
        camera_label: group.camera_label,
        record_type: group.record_type,
        work_name: group.work_name,
        record_start: group.record_start,
        record_end: group.record_end,
        total_duration_sec: group.total_duration_sec,
        segment_count: group.segment_count,
        thumbnail_url: group.thumbnail_url
            ? `${API_BASE}${group.thumbnail_url}`
            : undefined,
        streamUrl: group.segments?.[0]?.stream_url
            ? `${API_BASE}${group.segments[0].stream_url}`
            : undefined,
        segments: (group.segments || []).map((seg: any) => ({
            ...seg,
            stream_url: `${API_BASE}${seg.stream_url}`,
        })),
        status: group.status,
        error_reason: group.error_reason,
      };
    });

    return { items, total: data.total || 0, page: data.page || 1, size: data.size || 20 };
  } catch (e) {
    console.error("[videoData] 녹화 목록 조회 실패:", e);
    return { items: [], total: 0, page: 1, size: 20 };
  }
}
