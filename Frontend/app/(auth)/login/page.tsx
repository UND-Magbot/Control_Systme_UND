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
};

const PASSWORD_REGEX = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{6,12}$/;

export default function Login() {
    const router = useRouter();
    const { isAuthenticated, isLoading, login } = useAuth();
    const [loginForm, setLoginForm] = useState<LoginForm>({ userId: "", password: "" });
    const [errors, setErrors] = useState<LoginErrors>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 이미 로그인 상태면 대시보드로 리다이렉트
    useEffect(() => {
        if (!isLoading && isAuthenticated) router.replace("/dashboard");
    }, [isLoading, isAuthenticated, router]);

    const handleChange =
        (key: keyof LoginForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLoginForm((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => ({ ...prev, [key]: undefined }));
        };

    const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isSubmitting) return;

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

        // API 로그인
        setIsSubmitting(true);
        const result = await login(userId.trim(), password);
        setIsSubmitting(false);

        if (!result.success) {
            const errMsg = result.error ?? "로그인에 실패했습니다";
            if (errMsg.includes("아이디")) {
                setErrors({ userId: errMsg });
            } else if (errMsg.includes("비밀번호")) {
                setErrors({ password: errMsg });
            } else if (errMsg.includes("비활성화")) {
                setErrors({ userId: errMsg });
            } else {
                setErrors({ password: errMsg });
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
                    <button type="submit" className={styles.loginButton} disabled={isSubmitting}>
                        로그인
                    </button>
                </form>
            </section>
        </main>
    )
}
