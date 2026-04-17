/**
 * API 기본 주소. 브라우저 hostname + 백엔드 포트(8000)로 항상 직접 호출.
 * localhost 접속이든 원격 접속이든 동일한 경로로 백엔드에 도달한다.
 *
 * 함수로 제공 — 모듈 최상위 상수는 SSG 빌드 시 window가 없어 빈 문자열이 되므로,
 * 호출 시점에 런타임 hostname을 감지한다.
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:8000`;
  }
  return "";
}

/** 하위 호환용 상수 — 새 코드는 getApiBase() 사용 권장 */
export const API_BASE =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:8000`
    : "";

/**
 * 카메라 스트림(MJPEG) 전용 베이스.
 *
 * 원격 IP 접속 호환성을 위해 API_BASE와 동일한 origin을 사용한다.
 * HTTP/1.1 6-연결 제한 문제는 서버 쪽 대응(30초 주기 Connection: close
 * 재연결 + seamless 재접속)으로 커버한다.
 */
export const CAMERA_BASE = API_BASE;
