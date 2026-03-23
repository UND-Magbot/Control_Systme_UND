"use client";

import styles from './Login.module.css';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

type LoginForm = {
  userId: string;
  password: string;
};

type LoginErrors = {
  userId?: string;
  password?: string;
};

type LoginResult = {
  success: boolean;
  error?: "USER_NOT_FOUND" | "WRONG_PASSWORD";
};

// 임시 계정 (추후 JWT API 연동 시 삭제)
const TEMP_ACCOUNT = { userId: "admin", password: "admin1234!" };

// 인증 함수 — 추후 API 호출로 이 함수만 교체
async function loginWithCredentials(userId: string, password: string): Promise<LoginResult> {
    const account = TEMP_ACCOUNT.userId === userId ? TEMP_ACCOUNT : undefined;
    if (!account) return { success: false, error: "USER_NOT_FOUND" };
    if (account.password !== password) return { success: false, error: "WRONG_PASSWORD" };
    return { success: true };
}

const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,12}$/;

export default function Login() {
    const router = useRouter();
    const [loginForm, setLoginForm] = useState<LoginForm>({ userId: "", password: "" });
    const [errors, setErrors] = useState<LoginErrors>({});

    // 이미 로그인 상태면 대시보드로 리다이렉트
    useEffect(() => {
        const hasAuth = document.cookie.split(";").some((c) => c.trim().startsWith("auth="));
        if (hasAuth) router.replace("/dashboard");
    }, [router]);

    const handleChange =
        (key: keyof LoginForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLoginForm((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: undefined }));
        };

    const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const { userId, password } = loginForm;
        const newErrors: LoginErrors = {};

        // 빈 값 체크
        if (!userId.trim()) newErrors.userId = "아이디를 입력하세요";
        if (!password) newErrors.password = "비밀번호를 입력하세요";

        // 비밀번호 정규식 검증 (빈 값이 아닐 때만)
        if (password && !PASSWORD_REGEX.test(password)) {
            newErrors.password = "영문, 숫자, 특수문자 조합 6~12자리로 입력하세요";
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            return;
        }

        // 인증
        const result = await loginWithCredentials(userId.trim(), password);

        if (!result.success) {
            if (result.error === "USER_NOT_FOUND") {
                setErrors({ userId: "존재하지 않는 아이디입니다" });
            } else if (result.error === "WRONG_PASSWORD") {
                setErrors({ password: "비밀번호가 일치하지 않습니다" });
            }
            return;
        }

        document.cookie = `auth=1; path=/; max-age=${60 * 60 * 24}; samesite=lax`;
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
                        {errors.userId && <span className={styles.errorMsg}>{errors.userId}</span>}
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
                        {errors.password && <span className={styles.errorMsg}>{errors.password}</span>}
                    </div>

                    {/* 로그인 버튼 */}
                    <button type="submit" className={styles.loginButton}>
                        로그인
                    </button>
                </form>
            </section>
        </main>
    )
}
