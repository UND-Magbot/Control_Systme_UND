import type { Floor } from "@/app/types";
import { apiFetch } from "@/app/lib/api";

const FALLBACK_FLOORS: Floor[] = [
  { id: 1, label: "B2" },
  { id: 2, label: "B1" },
  { id: 3, label: "1F" },
  { id: 4, label: "2F" },
  { id: 5, label: "3F" },
];

/** floor_info에서 층 목록 조회 (실패 시 폴백) */
export default async function getFloor(): Promise<Floor[]> {
  try {
    const res = await apiFetch(`/map/floors`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: { id: number; FloorName: string }[] = await res.json();
    if (data.length === 0) return FALLBACK_FLOORS;
    return data.map((a) => ({ id: a.id, label: a.FloorName }));
  } catch {
    return FALLBACK_FLOORS;
  }
}
