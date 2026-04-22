// MenuKey → 프론트 경로/아이콘 매핑.
// DB의 menu_info는 이름/순서/가시성/트리 구조를 담당하고,
// path/icon은 페이지 컴포넌트와 정적 결합되어 있으므로 코드에서 관리한다.
// 새 그룹 메뉴를 DB에 추가하려면 여기에도 매핑 1줄을 추가해야 사이드바에 노출된다.

export const MENU_ROUTE_MAP: Record<string, { path: string; icon: string }> = {
  "dashboard":      { path: "/dashboard",           icon: "main" },
  "schedule-mgmt":  { path: "/scheduleManagement",  icon: "schedule" },
  "robot-mgmt":     { path: "/operationManagement", icon: "robot" },
  "map-management": { path: "/mapManagement",       icon: "map" },
  "data-mgmt":      { path: "/dataManagement",      icon: "data" },
  "alerts":         { path: "/alerts",              icon: "alerts" },
  "settings":       { path: "/settings",            icon: "setting" },
};
