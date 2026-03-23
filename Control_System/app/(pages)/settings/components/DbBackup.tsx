"use client";

import { useState } from 'react';
import styles from './DbBackup.module.css';

export default function DbBackup() {
  const [backupPath, setBackupPath] = useState("/home/und/app/backups/");
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBrowse = () => {
    alert("서버 경로를 직접 입력해주세요");
  };

  const handleBackup = async () => {
    setResult(null);
    setError(null);

    if (!backupPath.trim()) {
      setError("백업 경로를 입력해주세요");
      return;
    }

    setIsBackingUp(true);

    // Mock: 백업 시뮬레이션
    await new Promise((resolve) => setTimeout(resolve, 1500));

    setIsBackingUp(false);
    setResult({ success: true, message: "백업이 완료되었습니다" });
  };

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.title}>DB 백업</h2>

      <div className={styles.row}>
        <input
          type="text"
          className={`${styles.input} ${error ? styles.inputError : ""}`}
          value={backupPath}
          onChange={(e) => {
            setBackupPath(e.target.value);
            setError(null);
            setResult(null);
          }}
          placeholder="백업 경로를 입력하세요"
        />
        <button type="button" className={styles.browseBtn} onClick={handleBrowse}>
          탐색
        </button>
        <button
          type="button"
          className={styles.backupBtn}
          onClick={handleBackup}
          disabled={isBackingUp}
        >
          {isBackingUp ? "백업 중..." : "백업"}
        </button>
      </div>

      {error && <span className={styles.errorMsg}>{error}</span>}
      {result && (
        <span className={result.success ? styles.successMsg : styles.errorMsg}>
          {result.message}
        </span>
      )}
    </div>
  );
}
