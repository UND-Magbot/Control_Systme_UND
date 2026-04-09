import { apiFetch } from "@/app/lib/api";
import type { AlertMockData } from "@/app/mock/alerts_data";

type NoticeDetail = {
  Title: string;
  Content: string;
  Importance: string;
  UserId: number;
  UserName: string | null;
  AttachmentName: string | null;
  AttachmentUrl: string | null;
  AttachmentSize: number | null;
};

type AlertApiItem = {
  id: number;
  Type: "Robot" | "Notice" | "Schedule";
  Status: string | null;
  Content: string;
  Detail: string | null;
  ErrorJson: string | null;
  RobotName: string | null;
  date: string;
  isRead: boolean;
  NoticeId: number | null;
  notice: NoticeDetail | null;
};

type UnreadCount = {
  total: number;
  robot: number;
  schedule: number;
  notice: number;
};

type AlertListResponse = {
  items: AlertApiItem[];
  total: number;
  page: number;
  size: number;
  unread_count: UnreadCount;
};

/** API 응답을 프론트엔드 AlertMockData 형식으로 변환 */
function toAlertMockData(item: AlertApiItem): AlertMockData {
  // Notice: title = 공지 제목, content = 공지 본문, detail = 공지 본문
  // Robot/Schedule:
  //   - 신규(타이틀 분리): Content = 짧은 타이틀, Detail = 상세 메시지
  //   - 기존(미분리):       Content = 전체 메시지, Detail = null
  const isNotice = item.Type === "Notice";

  let title: string | undefined;
  let content: string;
  let detail: string | undefined;

  if (isNotice) {
    title = item.notice?.Title ?? undefined;
    content = item.notice?.Content ?? item.Content;
    detail = undefined;
  } else {
    if (item.Detail) {
      // 신규 포맷: Content = 짧은 타이틀, Detail = 상세 메시지
      title = item.Content;
      content = item.Detail;
    } else {
      // 기존 포맷: Content = 전체 메시지 → ":" 기준으로 타이틀 추출
      const colonIdx = item.Content.indexOf(": ");
      if (colonIdx > 0 && colonIdx <= 30) {
        title = item.Content.slice(0, colonIdx);
        content = item.Content.slice(colonIdx + 2);
      } else {
        title = undefined;
        content = item.Content;
      }
    }
    detail = undefined;  // Robot/Schedule은 errorJson 블록으로 표시
  }

  let errorJson: Record<string, unknown> | undefined;
  if (item.ErrorJson) {
    try { errorJson = JSON.parse(item.ErrorJson); } catch { errorJson = undefined; }
  }

  return {
    id: item.id,
    type: item.Type,
    status: (item.Status as "error" | "info" | "event") ?? undefined,
    content,
    date: item.date,
    robotName: item.RobotName ?? undefined,
    isRead: item.isRead,
    detail,
    errorJson,
    title,
    author: item.notice ? (item.notice.UserName ?? '-') : undefined,
    importance: (item.notice?.Importance as "high" | "normal") ?? undefined,
    attachmentName: item.notice?.AttachmentName ?? undefined,
    attachmentUrl: item.notice?.AttachmentUrl ?? undefined,
    attachmentSize: item.notice?.AttachmentSize ?? undefined,
    noticeId: item.NoticeId ?? undefined,
  };
}

export async function getAlerts(params?: {
  type?: string;
  status?: string;
  is_read?: string;
  search?: string;
  UserId?: number;
  page?: number;
  size?: number;
}): Promise<{ items: AlertMockData[]; total: number; page: number; size: number; unread_count: UnreadCount }> {
  const query = new URLSearchParams();
  if (params?.type) query.set("type", params.type);
  if (params?.status) query.set("status", params.status);
  if (params?.is_read) query.set("is_read", params.is_read);
  if (params?.search) query.set("search", params.search);
  if (params?.UserId) query.set("UserId", String(params.UserId));
  if (params?.page) query.set("page", String(params.page));
  if (params?.size) query.set("size", String(params.size));

  const res = await apiFetch(`/DB/alerts?${query.toString()}`);
  if (!res.ok) {
    return { items: [], total: 0, page: 1, size: 20, unread_count: { total: 0, robot: 0, schedule: 0, notice: 0 } };
  }

  const data: AlertListResponse = await res.json();
  return {
    ...data,
    items: data.items.map(toAlertMockData),
  };
}

export async function markAlertRead(alertId: number, UserId?: number): Promise<void> {
  const q = UserId != null ? `?UserId=${UserId}` : '';
  await apiFetch(`/DB/alerts/${alertId}/read${q}`, { method: "PUT" });
}

export async function markAllAlertsRead(UserId?: number, type?: string): Promise<void> {
  const params = new URLSearchParams();
  if (UserId != null) params.set('UserId', String(UserId));
  if (type) params.set('type', type);
  const q = params.toString() ? `?${params.toString()}` : '';
  await apiFetch(`/DB/alerts/read-all${q}`, { method: "PUT" });
}

export async function getUnreadCount(UserId?: number): Promise<UnreadCount> {
  const q = UserId != null ? `?UserId=${UserId}` : '';
  const res = await apiFetch(`/DB/alerts/unread-count${q}`);
  if (!res.ok) return { total: 0, robot: 0, schedule: 0, notice: 0 };
  return res.json();
}

export async function uploadNoticeFile(file: File): Promise<{ original_name: string; stored_name: string; url: string; size: number }> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch(`/DB/notices/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `업로드 실패 (${res.status})`);
  }
  return res.json();
}

export async function createNotice(data: {
  Title: string;
  Content: string;
  Importance: string;
  UserId?: number;
  AttachmentName?: string;
  AttachmentUrl?: string;
  AttachmentSize?: number;
}): Promise<{ status: string; id: number }> {
  const res = await apiFetch(`/DB/notices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '등록에 실패했습니다' }));
    throw new Error(err.detail ?? '등록에 실패했습니다');
  }
  return res.json();
}

export async function updateNotice(noticeId: number, data: {
  Title?: string;
  Content?: string;
  Importance?: string;
  AttachmentName?: string;
  AttachmentUrl?: string;
  AttachmentSize?: number;
}): Promise<void> {
  const res = await apiFetch(`/DB/notices/${noticeId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: '수정에 실패했습니다' }));
    throw new Error(err.detail ?? '수정에 실패했습니다');
  }
}

export async function deleteNotice(noticeId: number): Promise<void> {
  const res = await apiFetch(`/DB/notices/${noticeId}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail ?? `삭제 실패 (${res.status})`);
  }
}
