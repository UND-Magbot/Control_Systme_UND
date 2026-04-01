"use client";

import { useState } from 'react';
import styles from './DbBackup.module.css';
import { apiFetch } from '@/app/lib/api';

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

    try {
      const res = await apiFetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup_path: backupPath }),
      });

      const data = await res.json().catch(() => ({ detail: "응답을 처리할 수 없습니다" }));

      if (res.ok) {
        setResult({ success: true, message: `백업이 완료되었습니다 (${data.file_name})` });
      } else {
        setError(data.detail || "백업에 실패했습니다");
      }
    } catch {
      setError("서버에 연결할 수 없습니다");
    } finally {
      setIsBackingUp(false);
    }
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