import type { MenuNode } from "@/app/types";

/** 메뉴 트리에서 모든 리프 노드 ID를 수집. */
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

/** permissions 배열로부터 리프 노드별 체크 상태 Record 생성. */
export function permissionsToRecord(
  permissions: string[],
  allLeafIds: string[],
): Record<string, boolean> {
  const record: Record<string, boolean> = {};
  for (const id of allLeafIds) {
    record[id] = permissions.includes(id);
  }
  return record;
}
