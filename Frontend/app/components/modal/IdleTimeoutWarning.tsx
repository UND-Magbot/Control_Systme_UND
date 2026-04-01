"use client";

import styles from "./Modal.module.css";

type Props = {
  remainingSeconds: number;
  onExtend: () => void;
  onLogout: () => void;
};

export default function IdleTimeoutWarning({ remainingSeconds, onExtend, onLogout }: Props) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeDisplay = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div className={styles.confirmOverlay}>
      <div className={styles.confirmBox}>
        <div className={styles.confirmContents}>
          {`장시간 활동이 없어 ${timeDisplay} 후\n자동으로 로그아웃됩니다.`}
        </div>
        <div className={styles.confirmButtons}>
          <button
            className={`${styles.btnItemCommon} ${styles.btnBgRed}`}
            onClick={onLogout}
          >
            <span className={styles.btnIcon}>
              <img src="/icon/close_btn.png" alt="logout" />
            </span>
            <span>로그아웃</span>
          </button>
          <button
            className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}
            onClick={onExtend}
          >
            <span className={styles.btnIcon}>
              <img src="/icon/check.png" alt="extend" />
            </span>
            <span>계속 사용</span>
          </button>
        </div>
      </div>
    </div>
  );
}
