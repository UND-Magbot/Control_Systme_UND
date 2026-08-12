"use client";

import { useEffect, useState } from "react";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./ElevatorTab.module.css";

type Props = {
  open: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

// 시설 장치(엘리베이터·자동문) 생성/이름변경 — 네이티브 prompt 대신 디자인 시스템 커스텀 모달.
export default function ElevatorNameModal({
  open,
  title,
  initial = "",
  placeholder = "엘리베이터 이름 (예: 본관 승객용)",
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initial);

  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);

  if (!open) return null;

  const submit = () => {
    const v = name.trim();
    if (v) onSubmit(v);
  };

  return (
    <div className={modalStyles.confirmOverlay}>
      <div className={modalStyles.confirmBox}>
        <button className={modalStyles.closeBox} onClick={onCancel}>
          <img src="/icon/close_btn.png" alt="" />
        </button>
        <div className={modalStyles.confirmContents}>{title}</div>
        <div className={styles.nameInputWrap}>
          <input
            className={styles.nameInput}
            type="text"
            maxLength={50}
            autoFocus
            placeholder={placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
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
            disabled={!name.trim()}
            style={{ opacity: name.trim() ? 1 : 0.5 }}
          >
            <span className={modalStyles.btnIcon}><img src="/icon/check.png" alt="ok" /></span>
            <span>확인</span>
          </button>
        </div>
      </div>
    </div>
  );
}
