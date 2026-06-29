"use client";

import React from "react";
import styles from "../../../mapManagement.module.css";

type Props = {
  isOpen: boolean;
  onConfirm: () => void;
};

/**
 * 맵핑 완료 팝업 — 저장 성공 메시지 + 확인 버튼.
 */
export default function MappingSuccessModal({ isOpen, onConfirm }: Props) {
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.successPopup}>
        <div className={styles.successIcon}>&#10003;</div>
        <div className={styles.successText}>
          성공적으로 맵이 저장되었습니다.
        </div>
        <div className={styles.successGuide}>
          이 맵을 사용하려면 다음을 진행해 주세요.
          <br />
          1. 로봇을 <strong>해당 층으로 이동</strong>시킨 뒤 이 맵을 활성 맵으로 지정
          <br />
          (대시보드의 로봇 목록에서 맵핑을 완료한 로봇을 찾은 뒤 <strong>현재 층 변경</strong> 선택)
          <br />
          2. 이 맵에 <strong>충전소를 등록</strong>
          <br />
          충전소를 등록해야 전원 재기동(off→on) 시 충전소 기준으로 위치가 자동 초기화됩니다.
        </div>
        <button className={styles.btnConfirm} onClick={onConfirm}>
          확인
        </button>
      </div>
    </div>
  );
}
