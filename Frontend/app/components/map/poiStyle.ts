import { MapPin, BatteryCharging, Home, AlertTriangle, Target, type LucideIcon } from "lucide-react";
import type { POICategory } from "./types";

/**
 * 장소(POI) 카테고리별 아이콘·색상 — 대시보드(POIOverlay)와 맵관리(SVG)가 공유한다.
 * 두 화면의 마커 표현을 동일하게 유지하기 위한 단일 소스(괴리감 제거).
 *
 * 설계 원칙:
 *  - 카테고리는 '모양(아이콘)'으로 1차 구분 — 배경/색약 무관하게 의미 전달.
 *  - 색은 배경과 충돌 회피: 대시보드 맵이 '파랑'이고 로봇 마커도 파랑이므로
 *    장소에는 파랑 계열을 쓰지 않는다(특히 waypoint).
 */
export const CATEGORY_CONFIG: Record<POICategory, { icon: LucideIcon; color: string }> = {
  work:     { icon: Target,          color: "#ff6b6b" }, // 작업지 — 빨강 타겟(정밀 지점)
  charge:   { icon: BatteryCharging, color: "#4caf50" }, // 충전소 — 초록 배터리
  standby:  { icon: Home,            color: "#9c7cfa" }, // 대기 — 보라 홈
  waypoint: { icon: MapPin,          color: "#ff6b6b" }, // 경유점 — 빨강 핀(파랑 회피, 작업지와 아이콘으로 구분)
  danger:   { icon: AlertTriangle,   color: "#ff9800" }, // 위험 — 주황 경고
};

export const DEFAULT_CATEGORY_STYLE = CATEGORY_CONFIG.work;

/** 임의의 Category 문자열 → 아이콘·색 (미등록 카테고리는 work 로 폴백). */
export function getCategoryStyle(category?: string | null) {
  if (category && category in CATEGORY_CONFIG) {
    return CATEGORY_CONFIG[category as POICategory];
  }
  return DEFAULT_CATEGORY_STYLE;
}

/** DB Category 문자열 → POICategory (미등록은 work). */
export function toPoiCategory(category?: string | null): POICategory {
  if (category === "charge" || category === "waypoint" || category === "standby" || category === "danger") {
    return category;
  }
  return "work";
}

/** 로봇 마커 색 — 대시보드/맵관리 공통(통일). */
export const ROBOT_MARKER_FILL = "#1A73E8";
export const ROBOT_MARKER_STROKE = "#1557B0";
