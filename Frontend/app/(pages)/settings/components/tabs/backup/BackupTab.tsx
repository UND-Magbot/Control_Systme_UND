"use client";

import { useState } from 'react';
import styles from './BackupTab.module.css';
import { apiFetch } from '@/app/lib/api';

export default function BackupTab() {
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; path?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleBackup = async () => {
    setResult(null);
    setError(null);
    setIsBackingUp(true);

    try {
      const res = await apiFetch("/api/backup/download", {
        method: "POST",
      });

      if (res.ok) {
        const blob = await res.blob();
        const disposition = res.headers.get("content-disposition") || "";
        const match = disposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
        const fileName = match ? decodeURIComponent(match[1]) : "backup.sql";

        // showSaveFilePicker: 저장 경로 선택 대화상자 (Chrome/Edge)
        if ("showSaveFilePicker" in window) {
          try {
            const handle = await (window as any).showSaveFilePicker({
              suggestedName: fileName,
              types: [
                {
                  description: "SQL 파일",
                  accept: { "application/sql": [".sql"] },
                },
              ],
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            setResult({ success: true, message: `백업 저장 완료`, path: handle.name });
          } catch (e: any) {
            // 사용자가 대화상자를 취소한 경우
            if (e?.name === "AbortError") {
              setResult(null);
            } else {
              throw e;
            }
          }
        } else {
          // Fallback: 브라우저 기본 다운로드
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = fileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          setResult({ success: true, message: `백업 다운로드 완료`, path: `다운로드 폴더 / ${fileName}` });
        }
      } else {
        const data = await res.json().catch(() => ({ detail: "응답을 처리할 수 없습니다" }));
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
      <p className={styles.desc}>데이터베이스를 SQL 파일로 백업하여 다운로드합니다.</p>

      <div className={styles.row}>
        <button
          type="button"
          className={styles.backupBtn}
          onClick={handleBackup}
          disabled={isBackingUp}
        >
          {isBackingUp ? "백업 중..." : "백업 다운로드"}
        </button>
        <span className={styles.pathInfo}>
          저장 경로: {result?.path || "다운로드 폴더"}
        </span>
      </div>

      {error && <span className={styles.errorMsg}>{error}</span>}
      {result && (
        <div className={styles.resultRow}>
          <span className={result.success ? styles.successMsg : styles.errorMsg}>
            {result.message}
          </span>
          {result.path && (
            <span className={styles.pathInfo}>저장 경로: {result.path}</span>
          )}
        </div>
      )}
    </div>
  );
}