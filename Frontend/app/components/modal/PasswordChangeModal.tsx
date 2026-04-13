"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/app/lib/api';
import formStyles from './PasswordChangeModal.module.css';

const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,16}$/;

type Errors = {
  currentPassword?: string;
  newPassword?: string;
};

type Props = {
  onClose: () => void;
};

export default function PasswordChangeModal({ onClose }: Props) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async () => {
    const newErrors: Errors = {};
    setSuccessMessage(null);

    if (!currentPassword) {
      newErrors.currentPassword = "현재 비밀번호를 입력하세요";
    }

    if (!newPassword) {
      newErrors.newPassword = "새 비밀번호를 입력하세요";
    } else if (!PASSWORD_REGEX.test(newPassword)) {
      newErrors.newPassword = "영문, 숫자, 특수문자 조합 6~16자리로 입력하세요";
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
    <div className={formStyles.overlay} onMouseDown={onClose}>
      <div
        className={formStyles.box}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={formStyles.header}>
          <h2 className={formStyles.title}>비밀번호 변경</h2>
          <button className={formStyles.closeBtn} onClick={onClose}>
            <img src="/icon/close_btn.png" alt="닫기" />
          </button>
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>현재 비밀번호</label>
          <input
            type="password"
            className={`${formStyles.input} ${errors.currentPassword ? formStyles.inputError : ""}`}
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
            <span className={formStyles.errorMsg}>{errors.currentPassword}</span>
          )}
        </div>

        <div className={formStyles.field}>
          <label className={formStyles.label}>새 비밀번호</label>
          <input
            type="password"
            className={`${formStyles.input} ${errors.newPassword ? formStyles.inputError : ""}`}
            placeholder="영문 + 숫자 + 특수문자, 6~16자"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setErrors((prev) => ({ ...prev, newPassword: undefined }));
              setSuccessMessage(null);
            }}
            autoComplete="off"
          />
          {errors.newPassword && (
            <span className={formStyles.errorMsg}>{errors.newPassword}</span>
          )}
        </div>

        {successMessage && (
          <div className={formStyles.successMsg}>{successMessage}</div>
        )}

        <button
          type="button"
          className={formStyles.submitBtn}
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? "변경 중..." : "비밀번호 변경"}
        </button>
      </div>
    </div>
  );
}
