"use client";

import styles from "@/app/components/modal/Modal.module.css";

type Props = {
  open: boolean;
  message: string;
  mode: "alert" | "confirm";
  onConfirm: () => void;
  onClose: () => void;
};

export default function MapAlertModal({ open, message, mode, onConfirm, onClose }: Props) {
  if (!open) return null;

  return (
    <div className={styles.confirmOverlay}>
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
