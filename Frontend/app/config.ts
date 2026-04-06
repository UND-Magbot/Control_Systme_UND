/**
 * API 기본 주소.
 * - next dev  : rewrites 프록시 → same-origin ("" = 현재 호스트)
 * - 빌드+FastAPI 서빙 : 같은 서버 → same-origin ("" = 현재 호스트)
 * - 외부 PC 접속 : 브라우저 hostname + 백엔드 포트
 */
export const API_BASE =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `http://${window.location.hostname}:8000`
    : "";
