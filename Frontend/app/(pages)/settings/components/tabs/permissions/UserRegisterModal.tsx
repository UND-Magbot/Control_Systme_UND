"use client";

import { useState, useEffect, useMemo } from "react";
import styles from "./UserRegisterModal.module.css";
import modalStyles from "@/app/components/modal/Modal.module.css";
import { apiFetch } from "@/app/lib/api";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";

type RolePreset = "admin" | "user";

type Business = { id: number; BusinessName: string };

// 역할별 기본 메뉴 권한은 백엔드 seed.py의 MANAGER_MENUS/USER_DEFAULT_MENUS를 유일 출처로 사용.
// POST /api/users에서 menu_ids를 생략하면 서버가 permission 값에 따라 자동 적용한다.

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

  const roleOptions: SelectOption[] = [
    { id: "admin", label: "관리자" },
    { id: "user", label: "일반 사용자" },
  ];

  const businessOptions: SelectOption[] = useMemo(
    () => businesses.map((b) => ({ id: b.id, label: b.BusinessName })),
    [businesses]
  );

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

      const res = await apiFetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login_id: loginId.trim(),
          password,
          user_name: userName.trim(),
          permission,
          business_id: businessId || null,
          // menu_ids 생략 → 백엔드 seed.py 기본 프리셋 자동 적용
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
              placeholder="아이디를 입력하세요"
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
            <div className={styles.labelRow}>
              <label className={styles.label}>권한</label>
              <span className={styles.tooltipWrap}>
                <span className={styles.tooltipIcon}>?</span>
                <span className={styles.tooltipBox}>
                  <strong>관리자</strong>: DB 백업 제외 전체 메뉴<br />
                  <strong>일반 사용자</strong>: 대시보드, 작업관리, 데이터(로그 제외), 알림
                </span>
              </span>
            </div>
            <CustomSelect
              options={roleOptions}
              value={roleOptions.find((o) => o.id === role) ?? null}
              onChange={(o) => setRole(o.id as RolePreset)}
              placeholder="권한을 선택하세요"
              overlay
            />
          </div>

          {/* 사업장 */}
          <div className={styles.field}>
            <label className={styles.label}>사업장</label>
            <CustomSelect
              options={businessOptions}
              value={businessOptions.find((o) => o.id === businessId) ?? null}
              onChange={(o) => setBusinessId(o.id as number)}
              placeholder="사업장을 선택하세요"
              overlay
            />
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