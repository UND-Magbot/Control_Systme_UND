import { describe, it, expect } from "vitest";
import {
  formatElapsed,
  getNetworkBadge,
  getStaleStatusLabel,
  isPowerOnConfirmed,
  isRobotLive,
  isStatusStale,
} from "../robotLiveness";

describe("robotLiveness — 관제 서버 장애와 로봇 통신 두절 구분", () => {
  it("서버 정상이면 로봇 네트워크 상태를 그대로 표시한다", () => {
    expect(getNetworkBadge("Online", "ok")).toMatchObject({ label: "Online", tone: "online" });
    expect(getNetworkBadge("Offline", "ok")).toMatchObject({ label: "Offline", tone: "offline" });
    expect(getNetworkBadge("Error", "ok")).toMatchObject({ label: "끊김", tone: "error" });
  });

  it("서버 두절이면 로봇이 Online 이어도 '확인 불가'로 표시한다", () => {
    const badge = getNetworkBadge("Online", "unreachable");
    expect(badge.label).toBe("확인 불가");
    expect(badge.tone).toBe("unknown");
    expect(badge.tooltip).toContain("관제 서버 응답 없음");
  });

  it("서버 두절이면 로봇이 Offline 이어도 '오프라인'으로 단정하지 않는다", () => {
    expect(getNetworkBadge("Offline", "unreachable").label).toBe("확인 불가");
  });

  it("미등록 로봇은 서버 정상일 때만 Offline 로 표시한다", () => {
    expect(getNetworkBadge("-", "ok", { unregistered: true }).label).toBe("Offline");
    expect(getNetworkBadge("-", "unreachable", { unregistered: true }).label).toBe("확인 불가");
  });

  it("제어 활성화 판정은 서버 정상 + 로봇 Online 일 때만 true", () => {
    expect(isRobotLive("Online", "ok")).toBe(true);
    expect(isRobotLive("Online", "unreachable")).toBe(false);
    expect(isRobotLive("Offline", "ok")).toBe(false);
  });

  it("전원 On 확정 판정도 서버 두절이면 false", () => {
    expect(isPowerOnConfirmed("On", "ok")).toBe(true);
    expect(isPowerOnConfirmed("On", "unreachable")).toBe(false);
    expect(isPowerOnConfirmed("Off", "ok")).toBe(false);
  });

  it("stale 판정과 상태 라벨", () => {
    expect(isStatusStale("ok")).toBe(false);
    expect(isStatusStale("unreachable")).toBe(true);
    expect(getStaleStatusLabel("ok")).toBeNull();
    expect(getStaleStatusLabel("unreachable")?.label).toBe("확인 불가");
  });

  it("경과 시간 표기", () => {
    const now = 1_000_000_000;
    expect(formatElapsed(null, now)).toBe("확인된 적 없음");
    expect(formatElapsed(now - 12_000, now)).toBe("12초 전");
    expect(formatElapsed(now - 3 * 60_000, now)).toBe("3분 전");
    expect(formatElapsed(now - 2 * 3_600_000, now)).toBe("2시간 전");
    expect(formatElapsed(now - 3 * 86_400_000, now)).toBe("3일 전");
  });
});
