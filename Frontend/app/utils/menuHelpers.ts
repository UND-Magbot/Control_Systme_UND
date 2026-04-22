import type { MenuNode } from "@/app/types";

/** 메뉴 트리에서 권한 대상 리프 ID를 수집 (is_group=true 노드는 리프로 취급하지 않음). */
export function getAllLeafIds(nodes: MenuNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    const hasChildren = !!(node.children && node.children.length > 0);
    if (hasChildren) {
      ids.push(...getAllLeafIds(node.children!));
    } else if (!node.is_group) {
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
