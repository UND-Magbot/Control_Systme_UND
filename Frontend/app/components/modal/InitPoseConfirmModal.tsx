"use client";

import { useAuth } from "@/app/context/AuthContext";
import styles from "@/app/components/modal/InitPoseConfirmModal.module.css";

type Props = {
  open: boolean;
  robotId?: number;
  robotName?: string;
  detectedAt?: string;
  /** '수동 위치 재조정' — 스캔 정합 도구(RelocalizeModal)를 연다. */
  onManualAdjust?: () => void;
  /** 하위 호환(미사용) — 과거 '현재 위치로 확정' 콜백. */
  onResolved?: () => void;
  /** '나중에' — 모달만 닫음(알림은 알림센터에 유지, 미해결인 동안 다시 열람 가능). */
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
 *
 * 운영자 복구 경로: '수동 위치 재조정'을 누르면 스캔 정합 도구(RelocalizeModal)가 열려,
 * 맵 위 스캔을 보며 드래그로 로봇 위치를 지정·확정한다(로봇 연결 후 '위치 재조정'과 동일).
 * - '수동 위치 재조정' = onManualAdjust → RelocalizeModal open.
 * - '나중에' = 모달만 닫음(알림은 알림센터에 유지).
 *
 * 권한: 위치 재조정 액션은 관리자(슈퍼관리자·관리자, role 1·2)에게만 노출한다.
 * 일반 사용자(role 3)에게는 버튼 대신 '관리자에게 문의' 안내만 표시한다.
 */
export default function InitPoseConfirmModal({
  open,
  robotName,
  detectedAt,
  onManualAdjust,
  onClose,
  zIndex,
}: Props) {
  const { user } = useAuth();
  // 관리자급(1=슈퍼관리자, 2=관리자)만 위치 재조정 가능. 3=일반 사용자.
  const canAdjust = user?.role === 1 || user?.role === 2;

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      style={zIndex !== undefined ? { zIndex } : undefined}
      onClick={onClose}
    >
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="닫기">
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
          {canAdjust ? (
            <>
              <b>수동 위치 재조정</b>으로 맵에서 로봇 위치를 직접 맞춰 주세요.
            </>
          ) : (
            <>위치 재조정은 관리자 권한이 필요합니다.</>
          )}
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

        {canAdjust ? (
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onManualAdjust}
              autoFocus
            >
              수동 위치 재조정
            </button>
            <div className={styles.actionsRow}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnGhost}`}
                onClick={onClose}
              >
                나중에
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.actions}>
            <p className={styles.contactNotice}>관리자에게 문의해주세요.</p>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={onClose}
              autoFocus
            >
              확인
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
