/**
 * API 기본 주소. 브라우저 hostname + 백엔드 포트(8000)로 항상 직접 호출.
 * localhost 접속이든 원격 접속이든 동일한 경로로 백엔드에 도달한다.
 */
export const API_BASE =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:8000`
    : "";
