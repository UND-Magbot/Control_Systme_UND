"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./MenuManageTab.module.css";
import { apiFetch } from "@/app/lib/api";
import { useAuth } from "@/app/context/AuthContext";
import type { MenuAdminRow } from "@/app/types";

type Edited = Partial<Pick<MenuAdminRow, "menu_name" | "sort_order" | "is_visible">>;

export default function MenuManageTab() {
  const { refreshMenus } = useAuth();
  const [rows, setRows] = useState<MenuAdminRow[]>([]);
  const [edited, setEdited] = useState<Record<number, Edited>>({});
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/users/menus/admin");
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data) ? data : []);
      } else {
        setError("메뉴 목록을 불러오지 못했습니다");
      }
    } catch {
      setError("서버에 연결할 수 없습니다");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 부모 → 자식 목록 (sort_order 정렬)
  const childrenByParent = useMemo(() => {
    const map = new Map<number | null, MenuAdminRow[]>();
    for (const r of rows) {
      const key = r.parent_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    }
    return map;
  }, [rows]);

  const rootNodes = useMemo(() => childrenByParent.get(null) ?? [], [childrenByParent]);

  const collectDescendantIds = useCallback(
    (id: number): number[] => {
      const out: number[] = [];
      const stack: number[] = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        const children = childrenByParent.get(cur) ?? [];
        for (const c of children) {
          out.push(c.id);
          stack.push(c.id);
        }
      }
      return out;
    },
    [childrenByParent]
  );

  const setField = (id: number, patch: Edited) => {
    setMessage("");
    setError("");
    setEdited((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const toggleVisibility = (row: MenuAdminRow, checked: boolean) => {
    setMessage("");
    setError("");
    setEdited((prev) => {
      const next = { ...prev };
      next[row.id] = { ...next[row.id], is_visible: checked };
      if (row.is_group) {
        for (const id of collectDescendantIds(row.id)) {
          next[id] = { ...next[id], is_visible: checked };
        }
      }
      return next;
    });
  };

  const toggleCollapse = (id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => {
    const groups = rows.filter((r) => r.is_group).map((r) => r.id);
    setCollapsed(new Set(groups));
  };

  const currentValue = (r: MenuAdminRow): MenuAdminRow => {
    const e = edited[r.id];
    if (!e) return r;
    return {
      ...r,
      menu_name: e.menu_name ?? r.menu_name,
      sort_order: e.sort_order ?? r.sort_order,
      is_visible: e.is_visible ?? r.is_visible,
    };
  };

  const isDirty = (r: MenuAdminRow): boolean => {
    const e = edited[r.id];
    if (!e) return false;
    if (e.menu_name !== undefined && e.menu_name !== r.menu_name) return true;
    if (e.sort_order !== undefined && e.sort_order !== r.sort_order) return true;
    if (e.is_visible !== undefined && e.is_visible !== r.is_visible) return true;
    return false;
  };

  const dirtyCount = useMemo(
    () => rows.filter((r) => isDirty(r)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, edited]
  );

  const handleSaveAll = async () => {
    const dirty = rows.filter((r) => isDirty(r));
    if (dirty.length === 0) return;
    setIsSaving(true);
    setMessage("");
    setError("");
    try {
      for (const r of dirty) {
        const e = edited[r.id];
        const body: Edited = {};
        if (e.menu_name !== undefined && e.menu_name !== r.menu_name) body.menu_name = e.menu_name;
        if (e.sort_order !== undefined && e.sort_order !== r.sort_order) body.sort_order = e.sort_order;
        if (e.is_visible !== undefined && e.is_visible !== r.is_visible) body.is_visible = e.is_visible;
        const res = await apiFetch(`/api/users/menus/${r.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ detail: "저장에 실패했습니다" }));
          throw new Error(data.detail || "저장에 실패했습니다");
        }
      }
      await load();
      setEdited({});
      await refreshMenus();
      setMessage(`${dirty.length}개 메뉴가 저장되었습니다`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다");
    } finally {
      setIsSaving(false);
    }
  };

  const resetAll = () => {
    setEdited({});
    setMessage("");
    setError("");
  };

  // ── 공통 편집 행 렌더 (그룹 헤더 / 리프 / 자식 모두 재사용) ──
  const renderRow = (node: MenuAdminRow, variant: "group" | "root-leaf" | "child", childIndex?: number, siblingTotal?: number) => {
    const cur = currentValue(node);
    const dirty = isDirty(node);
    const isCollapsed = collapsed.has(node.id);
    const children = childrenByParent.get(node.id) ?? [];

    return (
      <div
        className={[
          styles.row,
          variant === "group" ? styles.groupHeaderRow : "",
          variant === "child" ? styles.childRow : "",
          variant === "root-leaf" ? styles.rootLeafRow : "",
          dirty ? styles.rowDirty : "",
        ].filter(Boolean).join(" ")}
      >
        {/* 1) chevron / 트리 커넥터 */}
        <div className={styles.colChevron}>
          {variant === "group" ? (
            <button
              type="button"
              className={styles.chevron}
              onClick={() => toggleCollapse(node.id)}
              aria-label={isCollapsed ? "펼치기" : "접기"}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          ) : variant === "child" ? (
            <span className={styles.treeConnector} aria-hidden>
              {childIndex === (siblingTotal ?? 0) - 1 ? "└─" : "├─"}
            </span>
          ) : (
            <span className={styles.colChevronSpacer} aria-hidden />
          )}
        </div>

        {/* 2) 메뉴명 + 경로 (세로 스택) */}
        <div className={styles.colName}>
          <input
            type="text"
            className={[
              styles.nameInput,
              variant === "group" ? styles.nameInputGroup : "",
            ].filter(Boolean).join(" ")}
            value={cur.menu_name}
            onChange={(e) => setField(node.id, { menu_name: e.target.value })}
            maxLength={100}
            placeholder="메뉴명"
          />
          <div className={styles.nameMetaRow}>
            <span className={styles.menuKey}>{node.menu_key}</span>
            {variant === "group" && children.length > 0 && (
              <span className={styles.childCount}>하위 {children.length}개</span>
            )}
          </div>
        </div>

        {/* 3) 표시 */}
        <div className={styles.colVis}>
          <label className={styles.visLabel}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={cur.is_visible}
              onChange={(e) => toggleVisibility(node, e.target.checked)}
              title={node.is_group ? "하위 메뉴도 함께 적용됩니다" : undefined}
            />
            <span className={styles.visText}>표시</span>
          </label>
        </div>

        {/* 4) 순서 */}
        <div className={styles.colSort}>
          <span className={styles.sortLabel}>순서</span>
          <input
            type="number"
            className={styles.sortInput}
            value={cur.sort_order}
            min={0}
            onChange={(e) => {
              const v = Number(e.target.value);
              setField(node.id, { sort_order: Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0 });
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.title}>메뉴 관리</h3>
          <p className={styles.desc}>
            메뉴 이름·정렬·표시 여부를 DB에서 수정합니다. 경로/아이콘은 코드로 관리됩니다.
          </p>
        </div>
        <div className={styles.headerRight}>
          <button type="button" className={styles.linkBtn} onClick={expandAll}>모두 펼치기</button>
          <button type="button" className={styles.linkBtn} onClick={collapseAll}>모두 접기</button>
          <span className={styles.headerDivider} />
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={resetAll}
            disabled={isSaving || dirtyCount === 0}
          >
            취소
          </button>
          <button
            type="button"
            className={styles.saveBtn}
            onClick={handleSaveAll}
            disabled={isSaving || dirtyCount === 0}
          >
            {isSaving ? "저장 중..." : `저장${dirtyCount > 0 ? ` (${dirtyCount})` : ""}`}
          </button>
        </div>
      </div>

      <div className={styles.messageBar}>
        {message && <div className={styles.message}>{message}</div>}
        {error && <div className={styles.errorMsg}>{error}</div>}
      </div>

      <div className={styles.listWrapper}>
        <div className={styles.list}>
          {rootNodes.map((root) => {
            if (!root.is_group) {
              // 단독 루트 리프 (예: 대시보드)
              return (
                <div key={root.id} className={styles.section}>
                  {renderRow(root, "root-leaf")}
                </div>
              );
            }

            // 그룹 섹션
            const children = childrenByParent.get(root.id) ?? [];
            const isOpen = !collapsed.has(root.id);
            return (
              <div key={root.id} className={`${styles.section} ${styles.groupSection} ${isOpen ? styles.open : styles.closed}`}>
                {renderRow(root, "group")}
                {isOpen && children.length > 0 && (
                  <div className={styles.childrenBlock}>
                    {children.map((child, idx) => (
                      <div key={child.id}>
                        {renderRow(child, "child", idx, children.length)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
