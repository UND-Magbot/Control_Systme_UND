"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import styles from './PermissionsTab.module.css';
import modalStyles from '@/app/components/modal/Modal.module.css';
import { getAllLeafIds, permissionsToRecord } from '@/app/utils/menuHelpers';
import type { MenuNode } from '@/app/types';
import { apiFetch } from '@/app/lib/api';
import { useAuth } from '@/app/context/AuthContext';
import UserRegisterModal from './UserRegisterModal';

type ApiUser = {
  id: number;
  login_id: string;
  user_name: string;
  permission: number;
  is_active: number;
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

/** 노드와 모든 하위 리프 ID를 수집 (그룹 노드는 리프로 취급하지 않음) */
function collectLeafIds(node: MenuNode): string[] {
  const hasChildren = !!(node.children && node.children.length > 0);
  if (!hasChildren) {
    return node.is_group ? [] : [node.id];
  }
  return node.children!.flatMap(collectLeafIds);
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
  disabled,
}: {
  state: CheckState;
  onChange: () => void;
  disabled?: boolean;
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
      disabled={disabled}
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
  lockedIds,
}: {
  node: MenuNode;
  leafStates: Record<string, boolean>;
  onToggle: (node: MenuNode) => void;
  onToggleExpand: (nodeId: string) => void;
  expandedNodes: Set<string>;
  searchQuery: string;
  depth: number;
  lockedIds: Set<string>;
}) {
  // 검색 필터: 매칭 안 되면 숨김
  if (searchQuery && !nodeMatchesSearch(node, searchQuery)) {
    return null;
  }

  const state = computeNodeState(node, leafStates);
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  // 리프가 잠금 대상이면 해당 노드(리프)는 완전 잠금. 그룹 노드는 자유롭게 토글 가능
  const isLocked = !hasChildren && lockedIds.has(node.id);

  const lockReason = isLocked
    ? node.id === "dashboard"
      ? "첫 화면 메뉴 필수"
      : "본인은 해제 불가"
    : null;

  return (
    <div className={styles.treeNode}>
      <div
        className={`${styles.treeRow} ${isLocked ? styles.treeRowLocked : ""}`}
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
        <TriCheckbox
          state={state}
          onChange={() => { if (!isLocked) onToggle(node); }}
          disabled={isLocked}
        />
        <span
          className={`${styles.treeLabel} ${hasChildren ? styles.treeLabelParent : ""}`}
          onClick={() => {
            if (hasChildren) onToggleExpand(node.id);
            else if (!isLocked) onToggle(node);
          }}
          title={lockReason ?? undefined}
        >
          {node.label}
        </span>
        {isLocked && (
          <>
            <span className={styles.lockIcon} aria-hidden>🔒</span>
            <span className={styles.lockCaption}>{lockReason}</span>
          </>
        )}
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
            lockedIds={lockedIds}
          />
        ))}
    </div>
  );
}

export default function PermissionsTab() {
  const { isAdmin, user: currentUser, refreshUser } = useAuth();
  const isManager = isAdmin || currentUser?.role === 2;

  // API에서 로드한 메뉴 트리
  const [menuTree, setMenuTree] = useState<MenuNode[]>([]);
  const allLeafIds = useMemo(() => getAllLeafIds(menuTree), [menuTree]);

  // API에서 로드한 사용자 목록
  const [apiUsers, setApiUsers] = useState<ApiUser[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);

  // 사용자 선택 상태
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [menuSearch, setMenuSearch] = useState("");

  // 메뉴 트리 API 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/users/menus");
        if (res.ok) {
          const data = await res.json();
          setMenuTree(data);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // 사용자 목록 API 로드
  useEffect(() => {
    if (!isManager) return;
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
  }, [isManager]);




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

  // 사용자 등록 모달
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // 사용자 등록 성공 후 목록 새로고침
  const refreshUserList = useCallback(async () => {
    try {
      const res = await apiFetch("/api/users?size=100");
      if (res.ok) {
        const data = await res.json();
        setApiUsers(data.items);
      }
    } catch { /* ignore */ }
  }, []);

  // 권한 상태
  const [leafStates, setLeafStates] = useState<Record<string, boolean>>({});
  const [originalStates, setOriginalStates] = useState<Record<string, boolean>>({});
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<ApiUser | null>(null);

  // 선택된 사용자 객체
  const selectedUser = useMemo(() => {
    return apiUsers.find((u) => u.id === selectedUserId) ?? null;
  }, [selectedUserId, apiUsers]);

  // 사용자 선택 시 권한 API 로드
  const handleSelectUser = useCallback(
    async (user: ApiUser) => {
      setSelectedUserId(user.id);
      try {
        const res = await apiFetch(`/api/users/${user.id}/permissions`);
        if (res.ok) {
          const data = await res.json();
          const record = permissionsToRecord(data.menu_ids, allLeafIds);
          // dashboard는 모든 사용자 필수 권한이므로 UI 상 항상 체크 상태 유지
          if (allLeafIds.includes("dashboard")) record["dashboard"] = true;
          // 본인 자기 수정 시 menu-permissions 해제 불가 → 항상 체크 표시
          if (currentUser && user.id === currentUser.id && allLeafIds.includes("menu-permissions")) {
            record["menu-permissions"] = true;
          }
          setLeafStates(record);
          setOriginalStates(record);
        }
      } catch {
        setLeafStates({});
        setOriginalStates({});
      }
    },
    [allLeafIds, currentUser]
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

  // 해제할 수 없는 리프 ID 집합 (dashboard는 모든 사용자 필수, menu-permissions는 본인 자기 수정 시만)
  const lockedIds = useMemo(() => {
    const set = new Set<string>();
    set.add("dashboard");
    if (currentUser && selectedUserId === currentUser.id) {
      set.add("menu-permissions");
    }
    return set;
  }, [currentUser, selectedUserId]);

  // 체크박스 토글
  const handleToggleNode = useCallback(
    (node: MenuNode) => {
      const state = computeNodeState(node, leafStates);
      const newChecked = state !== "checked"; // checked/indeterminate → unchecked, unchecked → checked
      const ids = collectLeafIds(node);

      setLeafStates((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          // 잠금 대상 리프는 false로 바꿀 수 없도록 강제 true 유지
          if (lockedIds.has(id)) {
            next[id] = true;
          } else {
            next[id] = newChecked;
          }
        }
        return next;
      });
    },
    [leafStates, lockedIds]
  );

  // 변경 여부 감지
  const isDirty = useMemo(() => {
    return Object.keys(leafStates).some(
      (key) => leafStates[key] !== originalStates[key]
    );
  }, [leafStates, originalStates]);

  // 사용자 변경 시 dirty 체크 → 저장 안 된 변경사항 있으면 확인 다이얼로그
  const handleSelectUserAttempt = useCallback(
    (user: ApiUser) => {
      if (user.id === selectedUserId) return;
      if (isDirty) {
        setPendingUser(user);
      } else {
        handleSelectUser(user);
      }
    },
    [isDirty, selectedUserId, handleSelectUser]
  );

  // 검색 중일 때 매칭 노드의 조상을 자동 펼침
  useEffect(() => {
    if (!menuSearch) return;
    const query = menuSearch.toLowerCase();
    const ancestorIds = new Set<string>();
    const walk = (nodes: MenuNode[], path: string[]) => {
      for (const n of nodes) {
        if (n.label.toLowerCase().includes(query)) {
          path.forEach((id) => ancestorIds.add(id));
        }
        if (n.children) walk(n.children, [...path, n.id]);
      }
    };
    walk(menuTree, []);
    if (ancestorIds.size === 0) return;
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      ancestorIds.forEach((id) => next.add(id));
      return next;
    });
  }, [menuSearch, menuTree]);

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
        // 본인 권한 수정 시 AuthContext 즉시 갱신 (세션은 유지, permissions·menus만 새로고침)
        if (currentUser && selectedUserId === currentUser.id) {
          await refreshUser();
        }
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
  const sortedUsers = useMemo(() => {
    const visible = isAdmin ? apiUsers : apiUsers.filter((u) => u.permission !== 1);
    return [...visible].sort((a, b) => a.permission - b.permission);
  }, [apiUsers, isAdmin, isManager]);
  const filteredUsers = useMemo(() => {
    if (!searchLower) return sortedUsers;
    return sortedUsers.filter((u) =>
      (u.user_name ?? "").toLowerCase().includes(searchLower) ||
      (u.login_id ?? "").toLowerCase().includes(searchLower)
    );
  }, [searchLower, sortedUsers]);

  const menuSearchLower = menuSearch.toLowerCase();

  return (
    <>
    <div className={styles.wrapper}>
      {/* 왼쪽: 사용자 선택 */}
      <div className={styles.leftPanel}>
        <div className={styles.leftHeader}>
          <h3 className={styles.panelTitle}>사용자 선택</h3>
          {isManager && (
            <button
              className={styles.registerBtn}
              onClick={() => setShowRegisterModal(true)}
            >
              + 사용자 등록
            </button>
          )}
        </div>

        <input
          type="text"
          className={styles.searchInput}
          placeholder="검색"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
        />

        <div className={styles.userList}>
          {filteredUsers.length === 0 ? (
            <div className={styles.emptyState}>검색 결과가 없습니다</div>
          ) : (
            filteredUsers.map((user) => (
              <label
                key={user.id}
                className={styles.userItem}
              >
                <input
                  type="checkbox"
                  className={styles.userCheckbox}
                  checked={selectedUserId === user.id}
                  onChange={() => handleSelectUserAttempt(user)}
                />
                <span className={styles.userLabel}>
                  {user.user_name ?? user.login_id}
                </span>
              </label>
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
                    lockedIds={lockedIds}
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

    <UserRegisterModal
      isOpen={showRegisterModal}
      onClose={() => setShowRegisterModal(false)}
      onSuccess={refreshUserList}
    />

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

    {pendingUser && (
      <div className={modalStyles.confirmOverlay}>
        <div className={modalStyles.confirmBox}>
          <button className={modalStyles.closeBox} onClick={() => setPendingUser(null)}>
            <img src="/icon/close_btn.png" alt="" />
          </button>
          <div className={modalStyles.confirmContents}>
            {`저장하지 않은 변경사항이 있습니다.\n사용자를 변경하시겠습니까?`}
          </div>
          <div className={modalStyles.confirmButtons}>
            <button
              className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgRed}`}
              onClick={() => setPendingUser(null)}
            >
              <span>취소</span>
            </button>
            <button
              className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue}`}
              onClick={() => {
                const u = pendingUser;
                setPendingUser(null);
                handleSelectUser(u);
              }}
            >
              <span>이동</span>
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
