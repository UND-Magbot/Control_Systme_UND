import { API_BASE } from "@/app/constants/api";

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (isRefreshing && refreshPromise) return refreshPromise;

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * 클라이언트 전용 인증 fetch 래퍼.
 * - credentials: include 자동 추가
 * - 401 시 자동 refresh 후 재시도
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

  // 401 시 refresh 시도
  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      res = await fetch(url, fetchOptions);
    }
    // refresh 실패 시 res(401)를 그대로 반환 — 리다이렉트는 호출측에서 처리
  }

  return res;
}
