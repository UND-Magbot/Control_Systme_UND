// 설정 페이지 Mock 데이터

export type MenuNode = {
  id: string;
  label: string;
  children?: MenuNode[];
};

export type MockUser = {
  id: string;
  name: string;
  role: "admin" | "user";
  group: string;
  permissions: string[]; // 체크된 메뉴 노드 ID 배열
};

export type UserGroup = {
  id: string;
  label: string;
  users: MockUser[];
};

/** 메뉴 트리 구조 (실제 앱 사이드바 + 하위 탭 반영) */
export const menuTree: MenuNode[] = [
  {
    id: "full-menu",
    label: "Full Menu",
    children: [
      { id: "dashboard", label: "대시보드" },
      {
        id: "robot-management",
        label: "로봇관리",
        children: [
          { id: "robot-list", label: "로봇 목록" },
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
      { id: "schedule-management", label: "작업관리" },
      {
        id: "alerts",
        label: "알림",
        children: [
          { id: "alert-total", label: "전체" },
          { id: "alert-schedule", label: "작업일정" },
          { id: "alert-emergency", label: "긴급사항" },
          { id: "alert-robot", label: "로봇상태" },
          { id: "alert-notice", label: "공지사항" },
        ],
      },
      {
        id: "settings",
        label: "설정",
        children: [
          { id: "db-backup", label: "DB 백업" },
          { id: "password-change", label: "비밀번호 변경" },
        ],
      },
    ],
  },
];

/** 사용자 그룹 및 사용자 목록 */
export const userGroups: UserGroup[] = [
  {
    id: "admin-group",
    label: "관리자",
    users: [
      {
        id: "admin",
        name: "관리자",
        role: "admin",
        group: "admin-group",
        permissions: [
          "dashboard",
          "robot-list", "place-list", "path-list",
          "video", "statistics", "log",
          "schedule-management",
          "alert-total", "alert-schedule", "alert-emergency", "alert-robot", "alert-notice",
        ],
      },
    ],
  },
  {
    id: "user-group",
    label: "사용자",
    users: [
      {
        id: "chris",
        name: "Chris",
        role: "user",
        group: "user-group",
        permissions: ["dashboard", "video"],
      },
      {
        id: "noah",
        name: "Noah",
        role: "user",
        group: "user-group",
        permissions: ["dashboard", "robot-list", "place-list", "path-list", "video", "statistics"],
      },
      {
        id: "jinny",
        name: "Jinny",
        role: "user",
        group: "user-group",
        permissions: ["dashboard", "log", "alert-total", "alert-notice"],
      },
    ],
  },
];

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
