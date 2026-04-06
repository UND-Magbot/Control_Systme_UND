import { API_BASE } from "@/app/constants/api";

// ── refresh 결과 타입 ──
// "success"  : 갱신 성공
// "invalid"  : refresh token 자체가 무효 (401) → 진짜 세션 만료
// "error"    : 네트워크/서버 문제 → 세션과 무관, 나중에 재시도
type RefreshResult = "success" | "invalid" | "error";

let isRefreshing = false;
let refreshPromise: Promise<RefreshResult> | null = null;

// ── 탭 간 refresh 동기화 ──
const refreshChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("auth_refresh")
    : null;

let lastRefreshTime = 0;
const REFRESH_DEBOUNCE_MS = 5_000;

refreshChannel?.addEventListener("message", (e) => {
  if (e.data?.type === "refreshed") {
    lastRefreshTime = Date.now();
  }
});

/**
 * 토큰 갱신 시도. 실패 원인을 구분하여 반환.
 */
export async function tryRefresh(): Promise<RefreshResult> {
  if (Date.now() - lastRefreshTime < REFRESH_DEBOUNCE_MS) return "success";

  if (isRefreshing && refreshPromise) return refreshPromise;

  isRefreshing = true;
  refreshPromise = (async (): Promise<RefreshResult> => {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 1_000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        });

        if (res.ok) {
          lastRefreshTime = Date.now();
          refreshChannel?.postMessage({ type: "refreshed" });
          console.debug("[Auth] refresh 성공");
          return "success";
        }

        // 401 = refresh token 자체가 무효 → 재시도 의미 없음
        if (res.status === 401) {
          console.warn("[Auth] refresh token 무효 (401)");
          return "invalid";
        }

        // 5xx 등 서버 오류 → 재시도
        console.warn(`[Auth] refresh 서버 오류 ${res.status} (${attempt + 1}/${MAX_RETRIES + 1})`);
      } catch (err) {
        console.warn(`[Auth] refresh 네트워크 에러 (${attempt + 1}/${MAX_RETRIES + 1})`, err);
      }

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }

    // 네트워크/서버 문제로 최종 실패 — 세션 자체가 무효한 건 아님
    return "error";
  })();

  try {
    return await refreshPromise;
  } finally {
    isRefreshing = false;
    refreshPromise = null;
  }
}

/**
 * 클라이언트 전용 인증 fetch 래퍼.
 * - 401 시 자동 refresh 후 재시도
 * - refresh token 무효(401)일 때만 세션 만료 판정
 * - 네트워크/서버 에러는 세션 만료로 취급하지 않음
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;

  const headers = new Headers(options.headers);
  if (!headers.has("X-Requested-With")) {
    headers.set("X-Requested-With", "XMLHttpRequest");
  }

  const fetchOptions: RequestInit = {
    ...options,
    credentials: "include",
    headers,
  };

  let res = await fetch(url, fetchOptions);

  if (res.status === 401) {
    const result = await tryRefresh();

    if (result === "success") {
      // 새 access token으로 재시도
      res = await fetch(url, fetchOptions);
    } else if (result === "invalid") {
      // refresh token 자체가 무효 → 진짜 세션 만료
      console.error("[Auth] 세션 만료: refresh token 무효");
      window.dispatchEvent(new CustomEvent("auth:session-expired"));
    }
    // result === "error" → 네트워크 문제, 세션은 건드리지 않음
  }

  return res;
}
