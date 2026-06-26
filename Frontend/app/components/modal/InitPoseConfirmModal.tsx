"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/app/lib/api";
import styles from "@/app/components/modal/InitPoseConfirmModal.module.css";

type CompareData = {
  charging: boolean;
  last_status: { x: number; y: number; floor?: number | null } | null;
  live: { x: number; y: number; yaw?: number; timestamp?: number } | null;
  delta_m: number | null;
};

type Props = {
  open: boolean;
  robotId?: number;
  robotName?: string;
  detectedAt?: string;
  /** '위치 재조정'(수동 init_pose) 수렴 성공 후 호출 — 모달 닫기 + 알림 읽음 처리 */
  onResolved: () => void;
  /** '나중에' — 모달만 닫음(알림은 알림센터에 유지) */
  onClose: () => void;
  zIndex?: number;
};

function formatTime(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * 자동 위치 확정 실패(robot_initpose_manual_needed) 시 띄우는 확인창.
 * - '위치 재조정'(POST /robot/initpose, 무본문) = 로봇이 지금 보고하는 현재 위치로 확정.
 *   수렴 성공(converged) 시 onResolved 로 닫고 읽음 처리. 실패 시 사유 노출 + 모달 유지(재시도).
 * - '나중에' = 모달만 닫음(알림 유지).
 */
export default function InitPoseConfirmModal({
  open,
  robotId,
  robotName,
  detectedAt,
  onResolved,
  onClose,
  zIndex,
}: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 위치 비교(마지막 확정 vs 현재 보고) — 비충전 시 확정 판단 정확도 보조.
  const [cmp, setCmp] = useState<CompareData | null>(null);

  useEffect(() => {
    if (!open) {
      setCmp(null);
      return;
    }
    let cancelled = false;
    const q = robotId !== undefined ? `?robot_id=${robotId}` : "";
    apiFetch(`/robot/initpose/compare${q}`)
      .then((r) => r.json())
      .then((d: CompareData) => {
        if (!cancelled) setCmp(d);
      })
      .catch(() => {
        if (!cancelled) setCmp(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, robotId]);

  if (!open) return null;

  // mode="current": 로봇 현재 보고 위치로 확정(무본문). mode="charge": 충전소 도킹 좌표로 주입.
  const submit = async (mode: "current" | "charge") => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);
      const payload =
        robotId !== undefined || mode === "charge"
          ? {
              ...(robotId !== undefined ? { robot_id: robotId } : {}),
              ...(mode === "charge" ? { target: "charge" } : {}),
            }
          : undefined;
      const res = await apiFetch("/robot/initpose", {
        method: "POST",
        signal: controller.signal,
        ...(payload
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }
          : {}),
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json().catch(() => ({}));
      if (data?.converged) {
        onResolved();
      } else {
        setError(
          data?.msg ||
            "위치가 아직 수렴하지 않았습니다. 로봇이 켜진 직후라면 잠시 후 다시 시도하세요."
        );
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const label = mode === "charge" ? "충전소 위치 지정" : "위치 재조정";
      setError(
        aborted
          ? `${label} 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.`
          : `${label} 실패 — 로봇 연결 상태를 확인하세요.`
      );
    } finally {
      setPending(false);
    }
  };

  const handleChargeReinit = () => submit("charge");

  return (
    <div
      className={styles.overlay}
      style={zIndex !== undefined ? { zIndex } : undefined}
      onClick={pending ? undefined : onClose}
    >
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="닫기"
          disabled={pending}
        >
          <img src="/icon/close_btn.png" alt="" />
        </button>

        <div className={styles.iconWrap} aria-hidden>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </div>

        <h2 className={styles.title}>로봇 위치 확인 필요</h2>
        <p className={styles.subtitle}>
          전원이 켜져 자율주행이 보류 중입니다.
          <br />
          로봇이 <b>충전소</b>에 있으면 <b>충전소 위치로 지정</b>을 누르세요.
          <br />
          충전소 위치가 아닐 경우 <b>관리자에게 문의</b>하세요.
        </p>

        {(robotName || detectedAt) && (
          <dl className={styles.meta}>
            {robotName && (
              <div className={styles.metaRow}>
                <dt>로봇</dt>
                <dd>{robotName}</dd>
              </div>
            )}
            {detectedAt && (
              <div className={styles.metaRow}>
                <dt>발생 시각</dt>
                <dd>{formatTime(detectedAt)}</dd>
              </div>
            )}
          </dl>
        )}

        {cmp?.charging && (
          <p style={{ margin: "0 0 14px", fontSize: "var(--font-size-sm)", color: "var(--text-accent)", textAlign: "center" }}>
            로봇이 충전 중입니다 — <b>충전소 위치로 지정</b>을 권장합니다.
          </p>
        )}

        {/* 비충전(충전소 아님): 자동/수동 초기화는 2차 개발 예정 — 안내 문구만 표시 */}
        {cmp && !cmp.charging && (
          <p style={{ margin: "0 0 14px", fontSize: "var(--font-size-sm)", color: "var(--color-warning)", textAlign: "center" }}>
            충전소 위치가 아닐 경우 <b>관리자에게 문의</b>하세요.
            <br />
            (충전소가 아닌 위치의 자동·수동 초기화는 추후 지원 예정)
          </p>
        )}

        {error && <p className={styles.errorMsg}>{error}</p>}

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={handleChargeReinit}
            disabled={pending}
            autoFocus
          >
            {pending ? (
              <>
                <span className={styles.spinner} aria-hidden />
                처리 중...
              </>
            ) : (
              "충전소 위치로 지정"
            )}
          </button>
          <div className={styles.actionsRow}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={onClose}
              disabled={pending}
            >
              나중에
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
