"use client";

import { useState, useEffect } from "react";
import styles from "./UserRegisterModal.module.css";
import modalStyles from "@/app/components/modal/Modal.module.css";
import { apiFetch } from "@/app/lib/api";

type RolePreset = "admin" | "user";

type Business = { id: number; BusinessName: string };

// 역할별 메뉴 권한 프리셋
const ROLE_MENU_MAP: Record<RolePreset, string[]> = {
  admin: [
    "dashboard", "schedule-list",
    "robot-list", "business-list",
    "map-edit", "place-list", "path-list",
    "video", "statistics", "log",
    "alert-total", "alert-schedule", "alert-robot", "alert-notice",
    "menu-permissions",
    // db-backup 제외
  ],
  user: [
    "dashboard", "schedule-list",
    "video", "statistics",
    // log 제외
    "alert-total", "alert-schedule", "alert-robot", "alert-notice",
  ],
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export default function UserRegisterModal({ isOpen, onClose, onSuccess }: Props) {
  const [userName, setUserName] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RolePreset>("user");
  const [businessId, setBusinessId] = useState<number | "">("");
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 사업장 목록 로드
  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const res = await apiFetch("/DB/businesses?size=100");
        if (res.ok) {
          const data = await res.json();
          setBusinesses(data.items ?? data);
        }
      } catch { /* ignore */ }
    })();
  }, [isOpen]);

  // 모달 열릴 때 초기화
  useEffect(() => {
    if (isOpen) {
      setUserName("");
      setLoginId("");
      setPassword("");
      setRole("user");
      setBusinessId("");
      setError("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    // 유효성 검증
    if (!userName.trim()) { setError("이름을 입력하세요"); return; }
    if (!loginId.trim()) { setError("아이디를 입력하세요"); return; }
    if (loginId.trim().length < 3) { setError("아이디는 3자 이상 입력하세요"); return; }
    if (!password) { setError("비밀번호를 입력하세요"); return; }
    if (password.length < 6 || password.length > 16) { setError("비밀번호는 6~16자리로 입력하세요"); return; }
    if (businessId === "") { setError("사업장을 선택하세요"); return; }

    setError("");
    setIsSubmitting(true);

    try {
      const permission = role === "admin" ? 2 : 3;
      const menuIds = ROLE_MENU_MAP[role];

      const res = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login_id: loginId.trim(),
          password,
          user_name: userName.trim(),
          permission,
          business_id: businessId || null,
          menu_ids: menuIds,
        }),
      });

      if (res.ok) {
        onSuccess();
        onClose();
      } else {
        const data = await res.json().catch(() => ({ detail: "등록에 실패했습니다" }));
        setError(data.detail);
      }
    } catch {
      setError("서버에 연결할 수 없습니다");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={modalStyles.confirmOverlay}>
      <div className={styles.modal}>
        {/* 헤더 */}
        <div className={styles.header}>
          <h3 className={styles.title}>사용자 등록</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <img src="/icon/close_btn.png" alt="닫기" />
          </button>
        </div>

        {/* 본문 */}
        <div className={styles.body}>
          {/* 이름 */}
          <div className={styles.field}>
            <label className={styles.label}>이름</label>
            <input
              type="text"
              className={styles.input}
              placeholder="이름을 입력하세요"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              maxLength={50}
            />
          </div>

          {/* 아이디 */}
          <div className={styles.field}>
            <label className={styles.label}>아이디</label>
            <input
              type="text"
              className={styles.input}
              placeholder="3자 이상 입력"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              maxLength={50}
            />
          </div>

          {/* 비밀번호 */}
          <div className={styles.field}>
            <label className={styles.label}>비밀번호</label>
            <input
              type="password"
              className={styles.input}
              placeholder="영문, 숫자, 특수문자 조합 6~16자리"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={16}
            />
          </div>

          {/* 권한 */}
          <div className={styles.field}>
            <label className={styles.label}>권한</label>
            <select
              className={styles.select}
              value={role}
              onChange={(e) => setRole(e.target.value as RolePreset)}
            >
              <option value="admin">관리자</option>
              <option value="user">일반 사용자</option>
            </select>
            <span className={styles.roleHint}>
              {role === "admin" && "DB 백업 제외 전체 메뉴"}
              {role === "user" && "대시보드, 작업관리, 데이터(로그 제외), 알림, 비밀번호 변경"}
            </span>
          </div>

          {/* 사업장 */}
          <div className={styles.field}>
            <label className={styles.label}>사업장</label>
            <select
              className={styles.select}
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">사업장을 선택하세요</option>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>{b.BusinessName}</option>
              ))}
            </select>
          </div>

          {/* 에러 메시지 */}
          {error && <div className={styles.error}>{error}</div>}
        </div>

        {/* 하단 버튼 */}
        <div className={styles.footer}>
          <button
            className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgRed}`}
            onClick={onClose}
          >
            <span className={modalStyles.btnIcon}><img src="/icon/close_btn.png" alt="" /></span>
            <span>취소</span>
          </button>
          <button
            className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue}`}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            <span className={modalStyles.btnIcon}><img src="/icon/check.png" alt="" /></span>
            <span>{isSubmitting ? "등록 중..." : "등록"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}