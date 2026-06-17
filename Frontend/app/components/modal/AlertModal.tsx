"use client";

import styles from "@/app/components/modal/Modal.module.css";

type Props = {
  open: boolean;
  message: string;
  mode: "alert" | "confirm";
  onConfirm: () => void;
  onClose: () => void;
  /** 기본 z-index(120) 위에 다른 모달(카메라 확대 등 z-index 200)이 있을 때
   *  알람을 더 위에 띄우기 위해 사용. 미지정 시 모듈 CSS의 기본 z-index 유지. */
  zIndex?: number;
};

export default function MapAlertModal({ open, message, mode, onConfirm, onClose, zIndex }: Props) {
  if (!open) return null;

  return (
    <div className={styles.confirmOverlay} style={zIndex !== undefined ? { zIndex } : undefined}>
      <div className={styles.confirmBox}>
        <button className={styles.closeBox} onClick={onClose}>
          <img src="/icon/close_btn.png" alt="" />
        </button>
        <div className={styles.confirmContents}>
          {message.split("\n").map((line, i) => (
            <span key={i}>{line}{i < message.split("\n").length - 1 && <br />}</span>
          ))}
        </div>
        <div className={styles.confirmButtons}>
          {mode === "confirm" && (
            <button className={`${styles.btnItemCommon} ${styles.btnBgRed}`} onClick={onClose}>
              <span className={styles.btnIcon}><img src="/icon/close_btn.png" alt="cancel" /></span>
              <span>취소</span>
            </button>
          )}
          <button className={`${styles.btnItemCommon} ${styles.btnBgBlue}`} onClick={onConfirm}>
            <span className={styles.btnIcon}><img src="/icon/check.png" alt="ok" /></span>
            <span>확인</span>
          </button>
        </div>
      </div>
    </div>
  );
}
