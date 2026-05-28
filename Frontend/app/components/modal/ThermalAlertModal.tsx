"use client";

import styles from "@/app/components/modal/ThermalAlertModal.module.css";

type Props = {
  open: boolean;
  temperature: number | null;
  robotName?: string;
  detectedAt?: string;
  onConfirm: () => void;
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

function severity(t: number | null): "warn" | "danger" {
  if (t == null) return "warn";
  return t >= 50 ? "danger" : "warn";
}

export default function ThermalAlertModal({
  open,
  temperature,
  robotName,
  detectedAt,
  onConfirm,
  onClose,
  zIndex,
}: Props) {
  if (!open) return null;

  const sev = severity(temperature);
  const tempText = temperature != null ? temperature.toFixed(1) : "--";

  return (
    <div
      className={styles.overlay}
      style={zIndex !== undefined ? { zIndex } : undefined}
      onClick={onClose}
    >
      <div
        className={`${styles.box} ${sev === "danger" ? styles.boxDanger : styles.boxWarn}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className={styles.closeBtn} onClick={onClose} aria-label="닫기">
          <img src="/icon/close_btn.png" alt="" />
        </button>

        <div
          className={`${styles.iconWrap} ${sev === "danger" ? styles.iconDanger : styles.iconWarn}`}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M14 4a2 2 0 1 0-4 0v9.535a4 4 0 1 0 4 0V4Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="17" r="2" fill="currentColor" />
            <path
              d="M12 6v9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h2 className={styles.title}>고온 감지</h2>
        <p className={styles.subtitle}>임계 온도 이상의 발열체가 감지되었습니다</p>

        <div
          className={`${styles.tempBlock} ${sev === "danger" ? styles.tempDanger : styles.tempWarn}`}
        >
          <span className={styles.tempValue}>{tempText}</span>
          <span className={styles.tempUnit}>°C</span>
        </div>

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
                <dt>감지 시각</dt>
                <dd>{formatTime(detectedAt)}</dd>
              </div>
            )}
          </dl>
        )}

        <div className={styles.actions}>
          <button className={styles.confirmBtn} onClick={onConfirm} autoFocus>
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
