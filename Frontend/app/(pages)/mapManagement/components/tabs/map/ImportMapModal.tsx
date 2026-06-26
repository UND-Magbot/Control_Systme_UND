"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "../../../mapManagement.module.css";
import { apiFetch } from "@/app/lib/api";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import type { Robot, FloorItem } from "../../../types/map";

type RobotMapEntry = {
  dir: string;
  name: string;
  created_at: string;
  complete: boolean;
  has_zip: boolean;
  is_active: boolean;
  already_imported: boolean;
};

type Props = {
  isOpen: boolean;
  robots: Robot[];
  floors: FloorItem[];
  defaultBizId: number | "";
  defaultFloorId: number | "";
  onClose: () => void;
  /** 가져오기 성공 시 부모가 맵 목록을 새로고침하도록 콜백 */
  onImported: (info: { map_id: number; floor_id: number; map_name: string }) => void;
};

const badge = (bg: string, color: string): React.CSSProperties => ({
  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
  background: bg, color, whiteSpace: "nowrap", letterSpacing: ".02em",
});

/**
 * 로봇(NOS) 내부 맵을 관제로 가져오는 모달.
 * - 표시 기준: 아직 관제 DB에 없는 맵(미등록)만 선택 가능. 단, 연결 로봇의 active 맵은 badge로 함께 표시.
 * - 가져온 맵 이름은 로봇 내부 디렉토리명(날짜 포함)과 동일하게 저장.
 * - 동기화(active 전파)는 별도 "동기화" 버튼 책임 — 여기서는 등록까지만.
 */
export default function ImportMapModal({
  isOpen, robots, floors, defaultBizId, defaultFloorId, onClose, onImported,
}: Props) {
  const [robotId, setRobotId] = useState<number | "">("");
  const [list, setList] = useState<RobotMapEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [picked, setPicked] = useState<RobotMapEntry | null>(null);
  const [floorId, setFloorId] = useState<number | "">(defaultFloorId);
  const [mapName, setMapName] = useState("");
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setRobotId(""); setList([]); setPicked(null); setListError(null);
      setFloorId(defaultFloorId); setMapName(""); setErr(null); setImporting(false);
    }
  }, [isOpen, defaultFloorId]);

  // 표시 목록: 완료된 맵만(미완결=occ_grid 미생성 숨김) 중 미등록 맵 + (이미 등록됐어도) 연결 로봇 active 맵
  // 정렬: active 최상단 → 나머지는 최신순(생성일 내림차순)
  const visible = useMemo(
    () =>
      list
        .filter((m) => m.complete && (!m.already_imported || m.is_active))
        .sort((a, b) => {
          if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
          return (b.created_at || b.dir).localeCompare(a.created_at || a.dir);
        }),
    [list]
  );

  useCustomScrollbar({
    enabled: isOpen && visible.length > 0,
    scrollRef, trackRef, thumbRef,
    minThumbHeight: 30,
    deps: [visible.length],
  });

  // 로봇 선택 → 내부 맵 목록 조회
  const onSelectRobot = async (id: number) => {
    setRobotId(id); setPicked(null); setMapName(""); setErr(null);
    setList([]); setListError(null); setLoading(true);
    try {
      const res = await apiFetch(`/map/robot-maps?robot_id=${id}`);
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.detail || `조회 실패 (HTTP ${res.status})`);
      }
      setList(await res.json());
    } catch (e) {
      setListError((e as Error)?.message || "로봇 맵 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 선택 가능: 완료 맵 + 아직 관제에 없는 맵만
  const selectable = (m: RobotMapEntry) => m.complete && !m.already_imported;

  const pick = (m: RobotMapEntry) => {
    if (!selectable(m)) return;
    setPicked(m);
    setMapName(m.dir);   // 로봇 내부 디렉토리명(날짜 포함)과 동일하게
    setErr(null);
  };

  const canImport = !!picked && !!mapName.trim() && floorId !== "" && defaultBizId !== "" && !importing;

  const handleImport = async () => {
    if (!canImport || !picked) return;
    setImporting(true); setErr(null);
    try {
      const res = await apiFetch(`/map/maps/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: 300_000,
        body: JSON.stringify({
          robot_id: robotId,
          dir: picked.dir,
          MapName: mapName.trim(),
          FloorId: floorId,
          BusinessId: defaultBizId,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => null);
        throw new Error(e?.detail || `가져오기 실패 (HTTP ${res.status})`);
      }
      const data = await res.json();
      onImported({ map_id: data.map_id, floor_id: data.floor_id, map_name: data.map_name });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        setErr("가져오기가 지연되고 있습니다. 잠시 후 맵 목록에서 생성 여부를 확인해주세요.");
      } else {
        setErr((e as Error)?.message || "가져오기에 실패했습니다.");
      }
      setImporting(false);
    }
  };

  // CustomSelect 옵션
  const robotOptions: SelectOption[] = robots.map((r) => ({ id: r.id, label: r.RobotName }));
  const robotValue = robotOptions.find((o) => o.id === robotId) ?? null;
  const floorOptions: SelectOption[] = floors.map((f) => ({ id: f.id, label: f.FloorName }));
  const floorValue = floorOptions.find((o) => o.id === floorId) ?? null;

  if (!isOpen) return null;

  return (
    <div className={styles.startOverlay} onClick={importing ? undefined : onClose}>
      <div className={styles.robotModal} onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxHeight: "92vh" }}>
        <div className={styles.startHeader}>
          <div className={styles.startHeaderLeft}>
            <h2>맵 가져오기</h2>
          </div>
          <button className={styles.startCloseBtn} onClick={onClose} disabled={importing}>&times;</button>
        </div>

        <div className={styles.robotBody} style={{ overflowY: "visible" }}>
          {/* 로봇 선택 */}
          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>로봇 선택</span>
              <div className={styles.startSectionLine} />
            </div>
            <CustomSelect
              options={robotOptions}
              value={robotValue}
              onChange={(o) => onSelectRobot(Number(o.id))}
              placeholder="로봇을 선택하세요"
              overlay
              emptyMessage="온라인 상태인 로봇이 없습니다"
            />
          </div>

          {/* 로봇 내부 맵 목록 */}
          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>로봇 내부 맵{visible.length > 0 ? ` · ${visible.length}` : ""}</span>
              <div className={styles.startSectionLine} />
            </div>

            {robotId === "" ? (
              <div className={styles.robotEmptyMsg}>로봇을 선택하면 내부 맵 목록을 불러옵니다.</div>
            ) : loading ? (
              <div className={styles.robotEmptyMsg}>로봇에서 맵 목록을 불러오는 중…</div>
            ) : listError ? (
              <div className={styles.robotEmptyMsg} style={{ color: "var(--color-error-soft)" }}>{listError}</div>
            ) : visible.length === 0 ? (
              <div className={styles.robotEmptyMsg}>가져올 새 맵이 없습니다 (모두 관제에 등록됨).</div>
            ) : (
              <div className={styles.importListWrap}>
                <div ref={scrollRef} className={styles.importScrollArea}>
                  {visible.map((m) => {
                    const disabled = !selectable(m);
                    return (
                      <button
                        key={m.dir}
                        className={`${styles.robotItem} ${picked?.dir === m.dir ? styles.robotItemActive : ""}`}
                        onClick={() => pick(m)}
                        disabled={disabled}
                        style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                      >
                        <div className={styles.robotItemLeft}>
                          <input
                            type="radio"
                            checked={picked?.dir === m.dir}
                            readOnly
                            disabled={disabled}
                            style={{ marginRight: 8, accentColor: "var(--color-info)" }}
                          />
                          <div>
                            <div className={styles.robotItemName}>{m.dir}</div>
                            {m.created_at && <div className={styles.robotItemInfo}><span>{m.created_at}</span></div>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 5 }}>
                          {m.is_active && <span style={badge("var(--color-success-bg)", "#dfffce")}>active</span>}
                          {m.already_imported && <span style={badge("var(--color-info-badge)", "#cdeefb")}>등록됨</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div ref={trackRef} className={styles.importScrollTrack}>
                  <div ref={thumbRef} className={styles.importScrollThumb} />
                </div>
              </div>
            )}
          </div>

          {/* 등록 정보 */}
          <div className={styles.startSection}>
            <div className={styles.startSectionTitle}>
              <span>등록 정보</span>
              <div className={styles.startSectionLine} />
            </div>
            <div className={styles.startRow}>
              <span className={styles.startLabel}>층</span>
              <div className={styles.startField}>
                <CustomSelect
                  options={floorOptions}
                  value={floorValue}
                  onChange={(o) => setFloorId(Number(o.id))}
                  placeholder="층 선택"
                  overlay
                  emptyMessage="층이 없습니다"
                />
              </div>
            </div>
            <div className={styles.startRow}>
              <span className={styles.startLabel}>맵 이름</span>
              <div className={styles.startField}>
                <input
                  className={styles.startInput}
                  value={mapName}
                  onChange={(e) => { setMapName(e.target.value); setErr(null); }}
                  placeholder="맵을 선택하면 자동 입력"
                />
              </div>
            </div>
            {err && (
              <div style={{ color: "var(--color-error-soft)", fontSize: 12, marginTop: 6 }}>{err}</div>
            )}
            <div style={{
              marginTop: 10, padding: "9px 11px", fontSize: 11, lineHeight: 1.6,
              background: "rgba(0,176,238,.07)", border: "1px solid var(--color-info-border)",
              borderLeft: "3px solid var(--color-info)", borderRadius: 7, color: "var(--text-tertiary)",
            }}>
              가져오기는 <b style={{ color: "var(--text-accent)" }}>이 로봇의 맵을 관제에 등록</b>까지만 합니다.
              같은 맵을 다른 로봇에도 적용하려면 <b style={{ color: "var(--text-accent)" }}>동기화</b> 버튼을 사용하세요.
            </div>
          </div>
        </div>

        <div className={styles.startFooter}>
          <button
            className={`${styles.startFooterBtn} ${styles.startBtnCancel}`}
            onClick={onClose}
            disabled={importing}
          >
            취소
          </button>
          <button
            className={`${styles.startFooterBtn} ${styles.startBtnStart}`}
            onClick={handleImport}
            disabled={!canImport}
          >
            {importing ? "가져오는 중…" : "가져오기"}
          </button>
        </div>

        {/* 진행 오버레이 */}
        {importing && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: 14,
            background: "linear-gradient(180deg,#262B3D,#1E2230)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 14, textAlign: "center", padding: 30,
          }}>
            <div style={{
              width: 22, height: 22, border: "2px solid rgba(255,255,255,.15)",
              borderTopColor: "var(--color-info)", borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }} />
            <div style={{ color: "var(--text-primary)", fontWeight: 600 }}>맵 가져오는 중…</div>
            <div style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
              압축 → 다운로드 → 변환 → DB 등록. 잠시만 기다려주세요.
            </div>
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}
      </div>
    </div>
  );
}
