"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './PasswordChange.module.css';
import { apiFetch } from '@/app/lib/api';

const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,12}$/;

type Errors = {
  currentPassword?: string;
  newPassword?: string;
};

export default function PasswordChange() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    const newErrors: Errors = {};
    setSuccessMessage(null);

    if (!currentPassword) {
      newErrors.currentPassword = "현재 비밀번호를 입력하세요";
    }

    if (!newPassword) {
      newErrors.newPassword = "새 비밀번호를 입력하세요";
    } else if (!PASSWORD_REGEX.test(newPassword)) {
      newErrors.newPassword = "영문, 숫자, 특수문자 조합 6~12자리로 입력하세요";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });

      if (res.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setErrors({});
        setSuccessMessage("비밀번호가 변경되었습니다. 다시 로그인해주세요.");
        setTimeout(() => router.replace("/login"), 2000);
      } else {
        const data = await res.json().catch(() => ({ detail: "비밀번호 변경에 실패했습니다" }));
        const msg = data.detail;
        if (msg.includes("현재 비밀번호")) {
          setErrors({ currentPassword: msg });
        } else {
          setErrors({ newPassword: msg });
        }
      }
    } catch {
      setErrors({ newPassword: "서버에 연결할 수 없습니다" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <h2 className={styles.title}>비밀번호 변경</h2>

        <div className={styles.field}>
          <label className={styles.label}>현재 비밀번호</label>
          <input
            type="password"
            className={`${styles.input} ${errors.currentPassword ? styles.inputError : ""}`}
            placeholder="현재 비밀번호를 입력해주세요"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setErrors((prev) => ({ ...prev, currentPassword: undefined }));
              setSuccessMessage(null);
            }}
            autoComplete="off"
          />
          {errors.currentPassword && (
            <span className={styles.errorMsg}>{errors.currentPassword}</span>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label}>새 비밀번호</label>
          <input
            type="password"
            className={`${styles.input} ${errors.newPassword ? styles.inputError : ""}`}
            placeholder="영문 + 숫자 + 특수문자, 6~12자"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setErrors((prev) => ({ ...prev, newPassword: undefined }));
              setSuccessMessage(null);
            }}
            autoComplete="off"
          />
          {errors.newPassword && (
            <span className={styles.errorMsg}>{errors.newPassword}</span>
          )}
        </div>

        {successMessage && (
          <div className={styles.successMsg}>{successMessage}</div>
        )}

        <button type="button" className={styles.submitBtn} onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "변경 중..." : "비밀번호 변경"}
        </button>
      </div>
    </div>
  );
}
