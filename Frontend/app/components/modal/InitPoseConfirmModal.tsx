"use client";

import styles from "@/app/components/modal/InitPoseConfirmModal.module.css";

type Props = {
  open: boolean;
  robotId?: number;
  robotName?: string;
  detectedAt?: string;
  /** 호환용(미사용) — 과거 '위치 재조정' 수렴 성공 콜백. 현재 모달은 액션 버튼이 없다. */
  onResolved?: () => void;
  /** '확인' — 모달 닫음(알림은 알림센터에 유지). */
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
 * 자동 위치 확정 실패(robot_initpose_manual_needed) 시 띄우는 안내창.
 *
 * 정책 변경: 운영자가 직접 초기화(위치 재조정/충전소 위치 지정)하던 액션 버튼을 제거하고,
 * '관리자에게 문의' 안내만 표시한다. (오조작으로 잘못된 위치가 확정되는 위험 방지)
 * - '확인' = 모달만 닫음(알림은 알림센터에 유지되어, 미해결인 동안 다시 열람 가능).
 */
export default function InitPoseConfirmModal({
  open,
  robotName,
  detectedAt,
  onClose,
  zIndex,
}: Props) {
  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      style={zIndex !== undefined ? { zIndex } : undefined}
      onClick={onClose}
    >
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="닫기"
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
          로봇이 자기 위치를 확인하지 못해 자율주행이 보류되었습니다.
          <br />
          <b>관리자에게 문의</b>해 주세요.
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

        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={onClose}
            autoFocus
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
