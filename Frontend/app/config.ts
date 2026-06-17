/**
 * 백엔드 포트. 관례상 8000이지만, 별개 프로젝트(und_cortex) 컨테이너가
 * 8000을 점유 중이라 로컬에서는 8010으로 분리 운영한다.
 */
const BACKEND_PORT = 8010;

/**
 * API 기본 주소. 브라우저 hostname + 백엔드 포트로 항상 직접 호출.
 * localhost 접속이든 원격 접속이든 동일한 경로로 백엔드에 도달한다.
 *
 * 함수로 제공 — 모듈 최상위 상수는 SSG 빌드 시 window가 없어 빈 문자열이 되므로,
 * 호출 시점에 런타임 hostname을 감지한다.
 */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:${BACKEND_PORT}`;
  }
  return "";
}

/** 하위 호환용 상수 — 새 코드는 getApiBase() 사용 권장 */
export const API_BASE =
  typeof window !== "undefined"
    ? `http://${window.location.hostname}:${BACKEND_PORT}`
    : "";

/**
 * MediaMTX WebRTC 포트. 관제 PC(Windows)에서 MediaMTX가 실행되며
 * 로봇 RTSP를 WebRTC(WHEP)로 저지연 변환해 송출한다.
 */
const MEDIAMTX_PORT = 8889;

/**
 * MediaMTX WebRTC(WHEP) 베이스 주소.
 * API_BASE와 동일하게 런타임 hostname을 사용 — localhost·원격 IP 접속 모두
 * 관제 PC의 MediaMTX로 동일 경로로 도달한다.
 */
export function getWebrtcBase(): string {
  if (typeof window !== "undefined") {
    return `http://${window.location.hostname}:${MEDIAMTX_PORT}`;
  }
  return "";
}

/**
 * 카메라 스트림(MJPEG) 전용 베이스.
 *
 * 원격 IP 접속 호환성을 위해 API_BASE와 동일한 origin을 사용한다.
 * HTTP/1.1 6-연결 제한 문제는 서버 쪽 대응(30초 주기 Connection: close
 * 재연결 + seamless 재접속)으로 커버한다.
 */
export const CAMERA_BASE = API_BASE;
