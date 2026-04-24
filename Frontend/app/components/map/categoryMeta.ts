import { MapPin, BatteryCharging, Home, Navigation } from "lucide-react";
import type { POICategory } from "./types";

export type CategoryMeta = {
  label: string;
  color: string;
  icon: typeof MapPin;
};

export const CATEGORY_META: Record<POICategory, CategoryMeta> = {
  work:     { label: "작업지", color: "#ff6b6b", icon: MapPin },
  charge:   { label: "충전소", color: "#4caf50", icon: BatteryCharging },
  standby:  { label: "대기소", color: "#9c7cfa", icon: Home },
  waypoint: { label: "경유지", color: "#64b4ff", icon: Navigation },
};

export const DEFAULT_CATEGORY: POICategory = "work";

export function getCategoryMeta(category?: string | null): CategoryMeta {
  if (category && category in CATEGORY_META) {
    return CATEGORY_META[category as POICategory];
  }
  return CATEGORY_META[DEFAULT_CATEGORY];
}
