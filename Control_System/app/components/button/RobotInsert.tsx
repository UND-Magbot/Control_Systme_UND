"use client";

import React, { useState } from 'react';
import styles from './Button.module.css';
import RobotInsertModal from "../modal/RobotInsertModal";

export default function RobotInsert() {

  // 로봇 등록 팝업
  const [robotInsertModalOpen, setRobotInsertModalOpen] = useState(false);

  return (
    <>
      <button type='button' className={styles.robotCrudBox} onClick={() => setRobotInsertModalOpen(true)}>
          <div className={styles.robotCrudBtn}>
              <img src="/icon/check.png" alt="check" />
          </div>
          <div>로봇 등록</div>
      </button>
      <RobotInsertModal isOpen={robotInsertModalOpen} onClose={() => setRobotInsertModalOpen(false)}/>
    </>
  )
} 