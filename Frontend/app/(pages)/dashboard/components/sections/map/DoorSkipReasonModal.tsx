"use client";

import { useEffect, useState } from "react";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./MapSection.module.css";

type Props = {
  open: boolean;
  doorName: string;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
};

// 통과 스킵(강제 진행) 확인 — 닫힌 문으로 진입할 위험이 있어 사유를 받고 전량 감사에 남긴다.
export default function DoorSkipReasonModal({ open, doorName, onSubmit, onCancel }: Props) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const v = reason.trim();
    if (v) onSubmit(v);
  };

  return (
    <div className={modalStyles.confirmOverlay}>
      <div className={modalStyles.confirmBox}>
        <button className={modalStyles.closeBox} onClick={onCancel}>
          <img src="/icon/close_btn.png" alt="" />
        </button>
        <div className={modalStyles.confirmContents}>통과 스킵 — 위험 작업</div>
        <div className={styles.skipWarn}>
          <b>{doorName}</b>이 열렸는지 확인하지 않은 채 로봇을 통과시킵니다.
          문이 닫혀 있으면 <b>충돌·끼임</b>이 발생할 수 있습니다. 현장을 직접 확인한 경우에만 진행하세요.
        </div>
        <div className={styles.skipInputWrap}>
          <input
            className={styles.skipInput}
            type="text"
            maxLength={100}
            autoFocus
            placeholder="사유 (감사 로그에 기록됩니다)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
        </div>
        <div className={modalStyles.confirmButtons}>
          <button className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgRed}`} onClick={onCancel}>
            <span className={modalStyles.btnIcon}><img src="/icon/close_btn.png" alt="cancel" /></span>
            <span>취소</span>
          </button>
          <button
            className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue}`}
            onClick={submit}
            disabled={!reason.trim()}
            style={{ opacity: reason.trim() ? 1 : 0.5 }}
          >
            <span className={modalStyles.btnIcon}><img src="/icon/check.png" alt="ok" /></span>
            <span>강제 진행</span>
          </button>
        </div>
      </div>
    </div>
  );
}
