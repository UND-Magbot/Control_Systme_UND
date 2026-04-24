"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { RefreshCw, X } from "lucide-react";
import styles from "../../../mapManagement.module.css";
import modalStyles from "@/app/components/modal/Modal.module.css";
import type { Robot } from "../../../types/map";
import { apiFetch } from "@/app/lib/api";

type Props = {
  isOpen: boolean;
  robots: Robot[];
  connectedRobots: Robot[];
  selectedConnectIds: number[];
  setSelectedConnectIds: React.Dispatch<React.SetStateAction<number[]>>;
  selectedMap: number | "";
  onClose: () => void;
  onConfirm: () => void;
  checking?: boolean;
};

type NetworkStatus = "Online" | "Offline";

const POLL_INTERVAL_MS = 5000;

export default function RobotConnectModal({
  isOpen,
  robots,
  connectedRobots,
  selectedConnectIds,
  setSelectedConnectIds,
  selectedMap,
  onClose,
  onConfirm,
  checking = false,
}: Props) {
  const [statusMap, setStatusMap] = useState<Map<number, NetworkStatus>>(new Map());
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusFetchFailed, setStatusFetchFailed] = useState(false);
  const [onlyAvailable, setOnlyAvailable] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setStatusLoading(true);
    try {
      const res = await apiFetch(`/robot/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { robot_id: number; network: string }[] = await res.json();
      const next = new Map<number, NetworkStatus>();
      for (const s of data) {
        next.set(s.robot_id, s.network === "Online" ? "Online" : "Offline");
      }
      setStatusMap(next);
      setStatusFetchFailed(false);
    } catch (err) {
      console.error("로봇 상태 조회 실패", err);
      if (!silent) setStatusFetchFailed(true);
    } finally {
      if (!silent) setStatusLoading(false);
    }
  }, []);

  const handleManualRefresh = useCallback(() => {
    fetchStatus();
  }, [fetchStatus]);

  // 모달 오픈 시 즉시 1회 조회 + 5초 폴링(silent), 닫힐 때 정리
  useEffect(() => {
    if (!isOpen) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    fetchStatus();
    pollTimerRef.current = setInterval(() => fetchStatus({ silent: true }), POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isOpen, fetchStatus]);

  // 오프라인으로 확정된 로봇이 선택 상태면 자동 해제 (이미 연결된 로봇은 유지)
  useEffect(() => {
    if (statusMap.size === 0) return;
    setSelectedConnectIds((prev) => {
      const connectedIds = new Set(connectedRobots.map((r) => r.id));
      const filtered = prev.filter((id) => {
        if (connectedIds.has(id)) return true;
        return statusMap.get(id) !== "Offline";
      });
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [statusMap, connectedRobots, setSelectedConnectIds]);

  const visibleRobots = useMemo(() => {
    if (!onlyAvailable) return robots;
    if (statusFetchFailed || statusMap.size === 0) return robots;
    const connectedIds = new Set(connectedRobots.map((r) => r.id));
    return robots.filter((r) => {
      if (connectedIds.has(r.id)) return true;
      return statusMap.get(r.id) === "Online";
    });
  }, [robots, onlyAvailable, statusMap, statusFetchFailed, connectedRobots]);

  if (!isOpen) return null;

  return (
    <div className={styles.startOverlay} onClick={onClose}>
      <div className={styles.robotModal} onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className={styles.startHeader}>
          <div className={styles.startHeaderLeft}>
            <img src="/icon/robot_w.png" alt="" />
            <h2>로봇 연결</h2>
          </div>
          <button
            className={styles.robotIconGhostBtn}
            onClick={onClose}
            aria-label="닫기"
          >
            <X size={22} strokeWidth={2} />
          </button>
        </div>

        {/* 본문 */}
        <div className={styles.robotBody}>
          {connectedRobots.length > 0 && (
            <div className={styles.robotConnectedBanner}>
              <span className={styles.robotConnectedDot} />
              <span>
                현재 연결:{" "}
                <strong>{connectedRobots.map((r) => r.RobotName).join(", ")}</strong>
              </span>
            </div>
          )}

          <div className={styles.startSection}>
            <div
              className={styles.startSectionTitle}
              style={{ fontSize: "var(--font-size-md)", minHeight: 32, alignItems: "center" }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", height: 32 }}>로봇 목록</span>
              <div className={styles.startSectionLine} />
              <label
                className={styles.robotFilterToggle}
                style={{ fontSize: "var(--font-size-sm)", height: 32 }}
                onClick={(e) => { e.preventDefault(); setOnlyAvailable((v) => !v); }}
              >
                <img
                  src={onlyAvailable ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                  alt=""
                  style={{ width: 14, height: 14 }}
                />
                오프라인 숨기기
              </label>
              <button
                type="button"
                className={`${styles.robotIconGhostBtn} ${styles.robotIconGhostBtnBordered}`}
                onClick={handleManualRefresh}
                disabled={statusLoading}
                aria-label="상태 새로고침"
                title="상태 새로고침"
                style={{ width: 24, height: 24 }}
              >
                <RefreshCw size={22} strokeWidth={2.25} />
              </button>
            </div>

            {robots.length === 0 ? (
              <div className={styles.robotEmptyMsg}>
                {selectedMap !== ""
                  ? "현재 맵을 사용 중인 로봇이 없습니다."
                  : "등록된 로봇이 없습니다."}
              </div>
            ) : visibleRobots.length === 0 ? (
              <div className={styles.robotEmptyMsg}>
                연결 가능한 로봇이 없습니다.
              </div>
            ) : (
              <div className={styles.robotList}>
                {visibleRobots.map((robot) => {
                  const isConnected = connectedRobots.some((r) => r.id === robot.id);
                  const status = statusMap.get(robot.id);
                  const isOffline = status === "Offline" && !isConnected;
                  const isSelected = selectedConnectIds.includes(robot.id);

                  return (
                    <button
                      key={robot.id}
                      type="button"
                      className={[
                        styles.robotItem,
                        isSelected ? styles.robotItemActive : "",
                        isOffline ? styles.robotItemDisabled : "",
                      ].filter(Boolean).join(" ")}
                      disabled={isOffline}
                      onClick={() => {
                        if (isOffline) return;
                        setSelectedConnectIds((prev) =>
                          prev.includes(robot.id)
                            ? prev.filter((id) => id !== robot.id)
                            : [...prev, robot.id]
                        );
                      }}
                    >
                      <div className={styles.robotItemLeft}>
                        <img
                          src={isSelected ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                          alt=""
                          className={styles.robotItemCheckbox}
                        />
                        <div>
                          <div className={styles.robotItemName}>{robot.RobotName}</div>
                          <div className={styles.robotItemInfo}>
                            {robot.ModelName && <span>{robot.ModelName}</span>}
                            {robot.SerialNumber && <span>SN: {robot.SerialNumber}</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {status === "Online" && (
                          <span className={styles.robotItemBadge}>온라인</span>
                        )}
                        {status === "Offline" && (
                          <span className={`${styles.robotItemBadge} ${styles.robotBadgeOffline}`}>오프라인</span>
                        )}
                        {!status && statusLoading && (
                          <span className={`${styles.robotItemBadge} ${styles.robotBadgeMuted}`}>확인 중</span>
                        )}
                        {isConnected && (
                          <span className={styles.robotItemBadge}>연결됨</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 푸터 */}
        <div className={styles.startFooter} style={{ borderTop: "none", gap: 10 }}>
          <button
            className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgRed}`}
            onClick={onClose}
            style={{ width: 120, height: 40, gap: 8, marginRight: 0 }}
          >
            <span className={modalStyles.btnIcon} style={{ width: 18, height: 16 }}>
              <img src="/icon/close_btn.png" alt="cancel" />
            </span>
            <span>취소</span>
          </button>
          <button
            className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue}`}
            onClick={onConfirm}
            disabled={checking}
            style={{
              width: 120,
              height: 40,
              gap: 8,
              ...(checking ? { opacity: 0.6, cursor: "not-allowed" } : undefined),
            }}
          >
            <span className={modalStyles.btnIcon} style={{ width: 18, height: 16 }}>
              <img src="/icon/check.png" alt="confirm" />
            </span>
            <span>{checking ? "연결 확인 중..." : "확인"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
