"use client";

import styles from './Modal.module.css';

type Props = {
  message: string;
  onConfirm: () => void;
}

export default function ConfirmOnlyModal({
  message,
  onConfirm
 }: Props) {

  return (
    <>
        <div className={styles.confirmOverlay}>
            <div className={styles.confirmBox}>
                <button  className={styles.closeBox} onClick={onConfirm}>
                  <img src="/icon/close_btn.png" alt="" />
                </button>
                <div className={styles.confirmContents}>{message}</div>

                <div className={styles.confirmButtons}>
                    <button className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}  onClick={onConfirm}>
                        <span className={styles.btnIcon}><img src="/icon/check.png" alt="confirm" /></span>
                        <span>확인</span>
                    </button>
                </div>
            </div>
        </div>
    </>
  );
}
