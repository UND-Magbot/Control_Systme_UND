"use client";

import styles from './Login.module.css';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { useCookies } from 'react-cookie';

type LoginForm = {
  userId: string;
  password: string;
};

export default function Login() {
    const router = useRouter();
    const [loginForm, setLoginForm] = useState<LoginForm>({ userId: "", password: "" });

    const [rememberChecked, setRememberChecked] = useState(false);
    const [cookies, setCookie, removeCookie] = useCookies(["rememberUserId"]);

    // 1) 최초 로드: 쿠키가 있으면 ID 자동 채움 + 체크 true
    useEffect(() => {
        const saved = cookies.rememberUserId;

        if (typeof saved === "string" && saved.length > 0) {
            setLoginForm((prev) => ({ ...prev, userId: saved }));
            setRememberChecked(true);
        }
        // cookies.rememberUserId 값이 바뀌어도 반영되도록 의존성 명시
    }, [cookies.rememberUserId]);

    // 2) 체크 상태에서 userId가 바뀌면 쿠키도 동기화
    useEffect(() => {
        if (!rememberChecked) return;
        if (!loginForm.userId) return;

        setCookie("rememberUserId", loginForm.userId, {
        maxAge: 2000,
        path: "/", // removeCookie와 반드시 동일하게
        sameSite: "lax",
        });
    }, [rememberChecked, loginForm.userId, setCookie]);

    const handleRememberClick = () => {
        setRememberChecked((prev) => {
        const next = !prev;

        if (next) {
            // 체크 ON → 현재 userId를 쿠키에 저장 (비어있으면 저장 안 함)
            if (loginForm.userId) {
            setCookie("rememberUserId", loginForm.userId, {
                maxAge: 2000,
                path: "/",
                sameSite: "lax",
            });
            }
        } else {
            // 체크 OFF → 쿠키 삭제
            removeCookie("rememberUserId", { path: "/" });
        }

        return next;
        });
    };

    const handleChange =
        (key: keyof LoginForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLoginForm((prev) => ({ ...prev, [key]: value }));
        };

    const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const { userId, password } = loginForm;
        if(!userId || !password) return;

        // if(userId != "admin" || password != "1234"){
        //     alert("다시 확인해주세요.");
        //     return;
        // }

        // 임시 인증
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
                    <img src="/icon/logo.png" alt="로고" />
                    <h1 id="login-title">Hospital Control System</h1>
                </header>

                {/* 로그인 폼 */}
                <form onSubmit={onSubmit} aria-describedby="login-desc">

                    {/* 아이디 */}
                    <div className={styles.field}>
                        <input
                        id="userId"
                        type="text"
                        value={loginForm.userId}
                        onChange={handleChange("userId")}
                        autoComplete="userId"
                        required
                        />
                    </div>

                    {/* 비밀번호 */}
                    <div className={styles.field}>
                        <input id="password" type="password" value={loginForm.password}
                            onChange={handleChange("password")}
                            autoComplete="password"
                            required
                        />
                    </div>

                    {/* 로그인 버튼 */}
                    <button type="submit" className={styles.loginButton}>
                        로그인
                    </button>
                </form>

                {/* 추가 옵션 */}
                <section className={styles.addEvent}>
                    {/* Remember Me → 진짜 체크박스 */}
                    <div className={styles.remember}>
                        <div className={styles.remember} onClick={handleRememberClick} role="button" tabIndex={0}>
                            <img src={rememberChecked ? "/icon/check-box-red.png" : "/icon/check-box.png"} alt="체크박스" />
                            <span>Remember Me</span>
                        </div>
                    </div>

                    <button type="button">Forgot Password ?</button>
                </section>
            </section>
        </main>
    )
}