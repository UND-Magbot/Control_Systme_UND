/**
 * "관제 서버 응답 없음" 과 "로봇 통신 두절" 을 구분하기 위한 헬퍼.
 *
 * /robot/status 는 인증(DB) 을 거치므로 관제 서버↔DB 가 끊기면 로봇이 멀쩡해도 500 이 난다.
 * 이때 화면의 로봇 상태 값은 마지막 성공 폴링 시점의 잔존값이며, 이를 '로봇 오프라인'으로
 * 표기하면 현장 원인 판단을 그르친다. 그래서 서버 두절 구간은 '확인 불가'로 따로 표시한다.
 */

export type ServerStatus = "ok" | "unreachable";
export type RobotNetwork = "Online" | "Offline" | "Error" | "-";
export type RobotPower = "On" | "Off" | "-";

export type NetworkBadge = {
  label: string;
  /** 색 계열 — 소비하는 쪽에서 자신의 CSS 모듈 클래스에 매핑한다. */
  tone: "online" | "error" | "offline" | "unknown";
  tooltip: string;
};

const STALE_TOOLTIP =
  "관제 서버 응답 없음 — 로봇 상태를 확인할 수 없습니다. 표시 값은 마지막 확인 시점 기준입니다.";

/** 서버 두절이면 화면의 모든 로봇 상태 값이 잔존값(stale)이다. */
export function isStatusStale(serverStatus: ServerStatus): boolean {
  return serverStatus !== "ok";
}

/**
 * 로봇이 지금 실제로 붙어있는지 — 제어 버튼 활성화 기준.
 * 서버가 두절이면 명령 자체가 나가지 않으므로 항상 false.
 */
export function isRobotLive(network: RobotNetwork, serverStatus: ServerStatus): boolean {
  return serverStatus === "ok" && network === "Online";
}

/** 전원 On 이 '지금 확인된' 상태인지 — 맵 마커 표시·원격 진입 기준. */
export function isPowerOnConfirmed(power: RobotPower, serverStatus: ServerStatus): boolean {
  return serverStatus === "ok" && power === "On";
}

/** 카드/목록의 네트워크 배지 표시값. 서버 두절이면 로봇 상태를 단정하지 않는다. */
export function getNetworkBadge(
  network: RobotNetwork,
  serverStatus: ServerStatus,
  opts: { unregistered?: boolean } = {}
): NetworkBadge {
  if (isStatusStale(serverStatus)) {
    return { label: "확인 불가", tone: "unknown", tooltip: STALE_TOOLTIP };
  }
  if (opts.unregistered) {
    return { label: "Offline", tone: "offline", tooltip: "등록 후 한 번도 연결된 적이 없습니다." };
  }
  if (network === "Error") {
    return { label: "끊김", tone: "error", tooltip: "로봇과의 통신 연결이 끊겼습니다." };
  }
  if (network === "Online") return { label: "Online", tone: "online", tooltip: "" };
  if (network === "Offline") return { label: "Offline", tone: "offline", tooltip: "" };
  return { label: "-", tone: "offline", tooltip: "" };
}

/** 운영관리 목록의 운영 상태 라벨(오프라인/오류) 앞단 — 서버 두절 구간만 가로챈다. */
export function getStaleStatusLabel(serverStatus: ServerStatus): { label: string; tooltip: string } | null {
  return isStatusStale(serverStatus) ? { label: "확인 불가", tooltip: STALE_TOOLTIP } : null;
}

/** "12초 전" / "3분 전" / "1시간 전" 형태의 경과 표기. */
export function formatElapsed(since: number | null, now: number = Date.now()): string {
  if (!since) return "확인된 적 없음";
  const sec = Math.max(0, Math.floor((now - since) / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}
