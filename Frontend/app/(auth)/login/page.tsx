"use client";

import styles from './Login.module.css';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';

type LoginForm = {
  userId: string;
  password: string;
};

type LoginErrors = {
  userId?: string;
  password?: string;
  form?: string;
};

const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,16}$/;

export default function Login() {
    const router = useRouter();
    const { isAuthenticated, isLoading, login } = useAuth();
    const [loginForm, setLoginForm] = useState<LoginForm>({ userId: "", password: "" });
    const [autoLogin, setAutoLogin] = useState(false);
    const [errors, setErrors] = useState<LoginErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSessionExpired, setIsSessionExpired] = useState(false);

    // 세션 만료 쿼리 파라미터 감지 후 URL에서 제거
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("reason") === "session_expired") {
            setIsSessionExpired(true);
            window.history.replaceState({}, "", "/login");
        }
    }, []);

    // 이미 로그인 상태면 대시보드로 리다이렉트
    useEffect(() => {
        if (!isLoading && isAuthenticated) router.replace("/dashboard");
    }, [isLoading, isAuthenticated, router]);

    const handleChange =
        (key: keyof LoginForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLoginForm((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: undefined, form: undefined }));
        if (isSessionExpired) setIsSessionExpired(false);
        };

    const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isSubmitting) return;

        const { userId, password } = loginForm;
        const newErrors: LoginErrors = {};

        // 빈 값 체크
        if (!userId.trim()) newErrors.userId = "아이디를 입력하세요";
        if (!password) newErrors.password = "비밀번호를 입력하세요";

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        // API 로그인
        setIsSubmitting(true);
        const result = await login(userId.trim(), password, autoLogin);
        setIsSubmitting(false);

        if (!result.success) {
            const errMsg = result.error ?? "로그인에 실패했습니다";
            if (errMsg.includes("비활성화")) {
                setErrors({ form: errMsg });
            } else if (errMsg.includes("아이디")) {
                setErrors({ userId: "존재하지 않는 아이디입니다" });
            } else if (!PASSWORD_REGEX.test(password)) {
                setErrors({ password: "영문, 숫자, 특수문자 조합 6~16자리로 입력하세요" });
            } else {
                setErrors({ password: "비밀번호가 일치하지 않습니다" });
            }
            return;
        }

        router.push("/dashboard");
    };

    return(
        <main className={styles.loginBackground}>
            <section
                className={styles.loginContainer}
                aria-labelledby="login-title"
            >
                {/* 화면 제목 */}
                <header className={styles.logo}>
                    <img src="/images/und_logo.png" alt="UND 로고" />
                    <h1 id="login-title">로그인</h1>
                </header>

                {/* 세션 만료 안내 */}
                {isSessionExpired && (
                    <div className={styles.sessionExpiredBanner}>
                        세션이 만료되었습니다. 다시 로그인해주세요.
                    </div>
                )}

                {/* 로그인 폼 */}
                <form onSubmit={onSubmit}>

                    {/* 아이디 */}
                    <div className={styles.field}>
                        <label htmlFor="userId">아이디</label>
                        <input
                            id="userId"
                            type="text"
                            className={errors.userId ? styles.inputError : ""}
                            placeholder="아이디를 입력하세요"
                            value={loginForm.userId}
                            onChange={handleChange("userId")}
                            autoComplete="off"
                        />
                        {errors.userId && !errors.form && <span className={styles.errorMsg}>{errors.userId}</span>}
                    </div>

                    {/* 비밀번호 */}
                    <div className={styles.field}>
                        <label htmlFor="password">비밀번호</label>
                        <input
                            id="password"
                            type="password"
                            className={errors.password ? styles.inputError : ""}
                            placeholder="비밀번호를 입력하세요"
                            value={loginForm.password}
                            onChange={handleChange("password")}
                            autoComplete="off"
                        />
                        {errors.password && !errors.form && <span className={styles.errorMsg}>{errors.password}</span>}
                    </div>

                    {/* 자동 로그인 */}
                    <label className={styles.autoLogin}>
                        <input
                            type="checkbox"
                            checked={autoLogin}
                            onChange={(e) => setAutoLogin(e.target.checked)}
                        />
                        <span className={styles.checkbox}>
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        </span>
                        <span>자동 로그인</span>
                    </label>

                    {errors.form && (
                        <div className={styles.errorMsg}>{errors.form}</div>
                    )}

                    {/* 로그인 버튼 */}
                    <button type="submit" className={styles.loginButton} disabled={isSubmitting}>
                        로그인
                    </button>
                </form>
            </section>
        </main>
    )
}
