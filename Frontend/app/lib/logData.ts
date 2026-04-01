import { apiFetch } from "@/app/lib/api";
import type { LogItem } from "@/app/type";

export type LogListResponse = {
  items: LogItem[];
  total: number;
  page: number;
  size: number;
};

export async function getLogData(params?: {
  category?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  size?: number;
}): Promise<LogListResponse> {
  const query = new URLSearchParams();
  if (params?.category) query.set("category", params.category);
  if (params?.search) query.set("search", params.search);
  if (params?.start_date) query.set("start_date", params.start_date);
  if (params?.end_date) query.set("end_date", params.end_date);
  if (params?.page) query.set("page", String(params.page));
  if (params?.size) query.set("size", String(params.size));

  const res = await apiFetch(`/DB/logs?${query.toString()}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    return { items: [], total: 0, page: 1, size: 20 };
  }

  return res.json();
}
