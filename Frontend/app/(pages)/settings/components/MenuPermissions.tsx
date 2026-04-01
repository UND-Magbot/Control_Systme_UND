"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import styles from './MenuPermissions.module.css';
import modalStyles from '@/app/components/modal/Modal.module.css';
import {
  getAllLeafIds,
  permissionsToRecord,
} from '@/app/mock/settings_data';
import type { MenuNode } from '@/app/mock/settings_data';
import { apiFetch } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';

type ApiUser = {
  id: number;
  login_id: string;
  user_name: string;
  permission: number;
  is_active: number;
};

type UserGroup = {
  id: string;
  label: string;
  users: ApiUser[];
};

/** 트리에서 노드의 체크 상태를 계산 */
type CheckState = "checked" | "unchecked" | "indeterminate";

function computeNodeState(
  node: MenuNode,
  leafStates: Record<string, boolean>
): CheckState {
  if (!node.children || node.children.length === 0) {
    return leafStates[node.id] ? "checked" : "unchecked";
  }
  const childStates = node.children.map((c) => computeNodeState(c, leafStates));
  if (childStates.every((s) => s === "checked")) return "checked";
  if (childStates.every((s) => s === "unchecked")) return "unchecked";
  return "indeterminate";
}

/** 노드와 모든 하위 리프 ID를 수집 */
function collectLeafIds(node: MenuNode): string[] {
  if (!node.children || node.children.length === 0) return [node.id];
  return node.children.flatMap(collectLeafIds);
}

/** 메뉴 트리에서 검색어에 매칭되는 노드가 있는지 확인 */
function nodeMatchesSearch(node: MenuNode, query: string): boolean {
  if (node.label.toLowerCase().includes(query)) return true;
  if (node.children) {
    return node.children.some((c) => nodeMatchesSearch(c, query));
  }
  return false;
}

/** 삼단 체크박스 컴포넌트 */
function TriCheckbox({
  state,
  onChange,
}: {
  state: CheckState;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = state === "indeterminate";
    }
  }, [state]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.checkbox}
      checked={state === "checked"}
      onChange={onChange}
    />
  );
}

/** 메뉴 트리 노드 렌더링 (재귀, 접이식) */
function MenuTreeNode({
  node,
  leafStates,
  onToggle,
  onToggleExpand,
  expandedNodes,
  searchQuery,
  depth,
}: {
  node: MenuNode;
  leafStates: Record<string, boolean>;
  onToggle: (node: MenuNode) => void;
  onToggleExpand: (nodeId: string) => void;
  expandedNodes: Set<string>;
  searchQuery: string;
  depth: number;
}) {
  // 검색 필터: 매칭 안 되면 숨김
  if (searchQuery && !nodeMatchesSearch(node, searchQuery)) {
    return null;
  }

  const state = computeNodeState(node, leafStates);
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);

  return (
    <div className={styles.treeNode}>
      <div
        className={styles.treeRow}
        style={{ paddingLeft: `${depth * 24}px` }}
      >
        {hasChildren ? (
          <span
            className={styles.treeArrow}
            onClick={() => onToggleExpand(node.id)}
          >
            {isExpanded ? "▾" : "▸"}
          </span>
        ) : (
          <span className={styles.treeArrowSpacer} />
        )}
        <TriCheckbox state={state} onChange={() => onToggle(node)} />
        <span
          className={`${styles.treeLabel} ${hasChildren ? styles.treeLabelParent : ""}`}
          onClick={() => hasChildren && onToggleExpand(node.id)}
        >
          {node.label}
        </span>
      </div>
      {hasChildren && isExpanded &&
        node.children!.map((child) => (
          <MenuTreeNode
            key={child.id}
            node={child}
            leafStates={leafStates}
            onToggle={onToggle}
            onToggleExpand={onToggleExpand}
            expandedNodes={expandedNodes}
            searchQuery={searchQuery}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

export default function MenuPermissions() {
  const { isAdmin } = useAuth();

  // API에서 로드한 메뉴 트리
  const [menuTree, setMenuTree] = useState<MenuNode[]>([]);
  const allLeafIds = useMemo(() => getAllLeafIds(menuTree), [menuTree]);

  // API에서 로드한 사용자 목록
  const [apiUsers, setApiUsers] = useState<ApiUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);

  // 사용자 선택 상태
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(["admin-group", "user-group"]));
  const [userSearch, setUserSearch] = useState("");
  const [menuSearch, setMenuSearch] = useState("");

  // 메뉴 트리 API 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/users/menus");
        if (res.ok) {
          const data = await res.json();
          // API 응답을 Full Menu 래퍼로 감싸기
          setMenuTree([{ id: "full-menu", label: "Full Menu", children: data }]);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // 사용자 목록 API 로드
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      try {
        const res = await apiFetch("/api/users?size=100");
        if (res.ok) {
          const data = await res.json();
          setApiUsers(data.items);
        }
      } catch { /* ignore */ }
      setIsLoadingUsers(false);
    })();
  }, [isAdmin]);

  // API 사용자를 그룹으로 분류
  const userGroups: UserGroup[] = useMemo(() => {
    const admins = apiUsers.filter((u) => u.permission === 1);
    const users = apiUsers.filter((u) => u.permission === 2);
    return [
      { id: "admin-group", label: "관리자", users: admins },
      { id: "user-group", label: "사용자", users: users },
    ];
  }, [apiUsers]);

  // 메뉴 트리 접이식 상태 (기본 모두 펼침, menuTree 로드 후 갱신)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set<string>();
    const collect = (nodes: MenuNode[]) => {
      for (const n of nodes) {
        if (n.children && n.children.length > 0) {
          ids.add(n.id);
          collect(n.children);
        }
      }
    };
    collect(menuTree);
    setExpandedNodes(ids);
  }, [menuTree]);

  // 권한 상태
  const [leafStates, setLeafStates] = useState<Record<string, boolean>>({});
  const [originalStates, setOriginalStates] = useState<Record<string, boolean>>({});
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  // 선택된 사용자 객체
  const selectedUser = useMemo(() => {
    for (const group of userGroups) {
      const user = group.users.find((u) => u.id === selectedUserId);
      if (user) return user;
    }
    return null;
  }, [selectedUserId, userGroups]);

  // 사용자 선택 시 권한 API 로드
  const handleSelectUser = useCallback(
    async (user: ApiUser) => {
      setSelectedUserId(user.id);
      try {
        const res = await apiFetch(`/api/users/${user.id}/permissions`);
        if (res.ok) {
          const data = await res.json();
          const record = permissionsToRecord(data.menu_ids, allLeafIds);
          setLeafStates(record);
          setOriginalStates(record);
        }
      } catch {
        setLeafStates({});
        setOriginalStates({});
      }
    },
    [allLeafIds]
  );

  // 메뉴 트리 노드 접이식 토글
  const toggleExpandNode = useCallback((nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // 그룹 토글
  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  // 체크박스 토글
  const handleToggleNode = useCallback(
    (node: MenuNode) => {
      const state = computeNodeState(node, leafStates);
      const newChecked = state !== "checked"; // checked/indeterminate → unchecked, unchecked → checked
      const ids = collectLeafIds(node);

      setLeafStates((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          next[id] = newChecked;
        }
        return next;
      });
    },
    [leafStates]
  );

  // 변경 여부 감지
  const isDirty = useMemo(() => {
    return Object.keys(leafStates).some(
      (key) => leafStates[key] !== originalStates[key]
    );
  }, [leafStates, originalStates]);

  // 저장
  const [isSaving, setIsSaving] = useState(false);
  const handleSave = async () => {
    if (!selectedUserId) return;
    setIsSaving(true);
    const menuIds = Object.entries(leafStates)
      .filter(([, v]) => v)
      .map(([k]) => k);
    try {
      const res = await apiFetch(`/api/users/${selectedUserId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menu_ids: menuIds }),
      });
      if (res.ok) {
        setOriginalStates({ ...leafStates });
        setConfirmMessage("저장되었습니다");
      } else {
        const data = await res.json().catch(() => ({ detail: "저장에 실패했습니다" }));
        setConfirmMessage(data.detail);
      }
    } catch {
      setConfirmMessage("서버에 연결할 수 없습니다");
    } finally {
      setIsSaving(false);
    }
  };

  // 사용자 검색 필터
  const searchLower = userSearch.toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!searchLower) return userGroups;
    return userGroups
      .map((group) => ({
        ...group,
        users: group.users.filter((u) =>
          (u.user_name ?? "").toLowerCase().includes(searchLower) ||
          (u.login_id ?? "").toLowerCase().includes(searchLower)
        ),
      }))
      .filter((group) => group.users.length > 0);
  }, [searchLower, userGroups]);

  const menuSearchLower = menuSearch.toLowerCase();

  return (
    <>
    <div className={styles.wrapper}>
      {/* 왼쪽: 사용자 선택 */}
      <div className={styles.leftPanel}>
        <h3 className={styles.panelTitle}>사용자 선택</h3>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="검색"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
        />

        <div className={styles.userList}>
          {filteredGroups.length === 0 ? (
            <div className={styles.emptyState}>검색 결과가 없습니다</div>
          ) : (
            filteredGroups.map((group) => (
              <div key={group.id}>
                <div
                  className={styles.groupHeader}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className={styles.groupArrow}>
                    {expandedGroups.has(group.id) ? "▾" : "▸"}
                  </span>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <span className={styles.groupCount}>{group.users.length}</span>
                </div>

                {expandedGroups.has(group.id) &&
                  group.users.map((user) => (
                    <label
                      key={user.id}
                      className={styles.userItem}
                    >
                      <input
                        type="checkbox"
                        className={styles.userCheckbox}
                        checked={selectedUserId === user.id}
                        onChange={() => handleSelectUser(user)}
                      />
                      <span className={styles.userLabel}>{user.user_name ?? user.login_id}</span>
                    </label>
                  ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 오른쪽: 메뉴 권한 */}
      <div className={styles.rightPanel}>
        {!selectedUser ? (
          <div className={styles.emptyStateCenter}>
            사용자를 선택하세요
          </div>
        ) : (
          <>
            <div className={styles.rightHeader}>
              <h3 className={styles.panelTitle}>
                <span className={styles.userName}>{selectedUser.user_name ?? selectedUser.login_id}</span>
                {" "}메뉴 권한
              </h3>
              <button
                type="button"
                className={styles.saveBtn}
                disabled={!isDirty || isSaving}
                onClick={handleSave}
              >
                {isSaving ? "저장 중..." : "저장"}
              </button>
            </div>

            <input
              type="text"
              className={styles.searchInput}
              placeholder="메뉴 검색"
              value={menuSearch}
              onChange={(e) => setMenuSearch(e.target.value)}
            />

            <div className={styles.menuTree}>
              {menuTree.map((node) => {
                if (
                  menuSearchLower &&
                  !nodeMatchesSearch(node, menuSearchLower)
                ) {
                  return null;
                }
                return (
                  <MenuTreeNode
                    key={node.id}
                    node={node}
                    leafStates={leafStates}
                    onToggle={handleToggleNode}
                    onToggleExpand={toggleExpandNode}
                    expandedNodes={expandedNodes}
                    searchQuery={menuSearchLower}
                    depth={0}
                  />
                );
              })}
              {menuSearchLower &&
                !menuTree.some((n) =>
                  nodeMatchesSearch(n, menuSearchLower)
                ) && (
                  <div className={styles.emptyState}>검색 결과가 없습니다</div>
                )}
            </div>
          </>
        )}
      </div>
    </div>

    {confirmMessage && (
      <div className={modalStyles.confirmOverlay}>
        <div className={modalStyles.confirmBox}>
          <button className={modalStyles.closeBox} onClick={() => setConfirmMessage(null)}>
            <img src="/icon/close_btn.png" alt="" />
          </button>
          <div className={modalStyles.confirmContents}>{confirmMessage}</div>
          <div className={modalStyles.confirmButtons}>
            <button
              className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue}`}
              onClick={() => setConfirmMessage(null)}
            >
              <span className={modalStyles.btnIcon}><img src="/icon/check.png" alt="확인" /></span>
              <span>확인</span>
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
