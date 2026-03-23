"use client";

import { useState } from 'react';
import styles from './PasswordChange.module.css';

const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,}$/;

// 임시 계정 (추후 JWT API 연동 시 교체)
const TEMP_PASSWORD = "admin1234!";

type Errors = {
  currentPassword?: string;
  newPassword?: string;
};

export default function PasswordChange() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = () => {
    const newErrors: Errors = {};
    setSuccessMessage(null);

    if (!currentPassword) {
      newErrors.currentPassword = "현재 비밀번호를 입력하세요";
    }

    if (!newPassword) {
      newErrors.newPassword = "새 비밀번호를 입력하세요";
    } else if (!PASSWORD_REGEX.test(newPassword)) {
      newErrors.newPassword = "영문, 숫자, 특수문자 조합 6자 이상으로 입력하세요";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Mock 검증: 현재 비밀번호 확인
    if (currentPassword !== TEMP_PASSWORD) {
      setErrors({ currentPassword: "현재 비밀번호가 일치하지 않습니다" });
      return;
    }

    if (newPassword === currentPassword) {
      setErrors({ newPassword: "현재 비밀번호와 다른 비밀번호를 입력하세요" });
      return;
    }

    // Mock 성공
    setCurrentPassword("");
    setNewPassword("");
    setErrors({});
    setSuccessMessage("비밀번호가 변경되었습니다");
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
            placeholder="영문 + 숫자 + 특수문자, 6자 이상"
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

        <button type="button" className={styles.submitBtn} onClick={handleSubmit}>
          비밀번호 변경
        </button>
      </div>
    </div>
  );
}
