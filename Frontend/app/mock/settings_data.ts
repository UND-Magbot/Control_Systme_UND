// 설정 페이지 Mock 데이터

export type MenuNode = {
  id: string;
  label: string;
  children?: MenuNode[];
};

// MockUser, UserGroup 타입은 MenuPermissions.tsx에서 API 기반으로 정의됨

/** 메뉴 트리 구조 (실제 앱 사이드바 + 하위 탭 반영) */
export const menuTree: MenuNode[] = [
  {
    id: "full-menu",
    label: "Full Menu",
    children: [
      { id: "dashboard", label: "대시보드" },
      {
        id: "schedule-management",
        label: "작업관리",
        children: [
          { id: "schedule-list", label: "작업 목록" },
        ],
      },
      {
        id: "robot-management",
        label: "운영관리",
        children: [
          { id: "robot-list", label: "로봇 목록" },
          { id: "business-list", label: "사업자 목록" },
        ],
      },
      {
        id: "map-management",
        label: "맵 관리",
        children: [
          { id: "map-edit", label: "맵 편집" },
          { id: "place-list", label: "장소 목록" },
          { id: "path-list", label: "경로 목록" },
        ],
      },
      {
        id: "data-management",
        label: "데이터관리",
        children: [
          { id: "video", label: "영상" },
          { id: "statistics", label: "통계" },
          { id: "log", label: "로그" },
        ],
      },
      {
        id: "alerts",
        label: "알림",
        children: [
          { id: "alert-total", label: "전체" },
          { id: "alert-schedule", label: "스케줄" },
          { id: "alert-robot", label: "로봇" },
          { id: "alert-notice", label: "공지사항" },
        ],
      },
      {
        id: "settings",
        label: "설정",
        children: [
          { id: "menu-permissions", label: "메뉴 권한" },
          { id: "password-change", label: "비밀번호 변경" },
          { id: "db-backup", label: "DB 백업" },
        ],
      },
    ],
  },
];

/** 전체 리프 메뉴 ID 목록 (관리자 시드용) */
export const ALL_MENU_IDS: string[] = getAllLeafIds(menuTree);

/** 메뉴 트리에서 모든 리프 노드 ID를 수집 */
export function getAllLeafIds(nodes: MenuNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      ids.push(...getAllLeafIds(node.children));
    } else {
      ids.push(node.id);
    }
  }
  return ids;
}

/** permissions 배열로부터 리프 노드별 체크 상태 Record 생성 */
export function permissionsToRecord(
  permissions: string[],
  allLeafIds: string[]
): Record<string, boolean> {
  const record: Record<string, boolean> = {};
  for (const id of allLeafIds) {
    record[id] = permissions.includes(id);
  }
  return record;
}
