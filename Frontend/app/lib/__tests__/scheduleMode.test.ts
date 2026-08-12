import { describe, it, expect } from "vitest";
import {
  resolveScheduleMode,
  getScheduleModeLabel,
  isActiveWindowMode,
} from "@/app/lib/scheduleMode";

describe("resolveScheduleMode", () => {
  it("ScheduleMode 가 있으면 그걸 쓴다 — Repeat 플래그가 덮어쓰지 않는다", () => {
    // standby 는 Repeat='Y' 로 저장된다. 예전엔 Repeat 를 먼저 봐서 weekly 로 흡수됐다.
    expect(resolveScheduleMode({ ScheduleMode: "standby", Repeat: "Y" })).toBe("standby");
    expect(resolveScheduleMode({ ScheduleMode: "interval", Repeat: "Y" })).toBe("interval");
  });

  it("ScheduleMode 가 없는 구 데이터는 Repeat 로 판정한다", () => {
    expect(resolveScheduleMode({ Repeat: "Y" })).toBe("weekly");
    expect(resolveScheduleMode({ Repeat: "N" })).toBe("once");
    expect(resolveScheduleMode({})).toBe("once");
  });
});

describe("getScheduleModeLabel", () => {
  it("네 모드가 화면마다 같은 이름으로 나온다", () => {
    expect(getScheduleModeLabel("once")).toBe("단일");
    expect(getScheduleModeLabel("weekly")).toBe("요일반복");
    expect(getScheduleModeLabel("interval")).toBe("주기반복");
    expect(getScheduleModeLabel("standby")).toBe("상시대기");
  });

  it("long=true 는 등록 화면용 문장형", () => {
    expect(getScheduleModeLabel("standby", true)).toBe("상시 대기");
    expect(getScheduleModeLabel("interval", true)).toBe("주기 반복");
  });

  it("모르는 모드는 원문을 그대로 낸다 — 아는 값으로 흡수하면 오표시가 된다", () => {
    expect(getScheduleModeLabel("newmode")).toBe("newmode");
  });
});

describe("isActiveWindowMode", () => {
  it("운영 시간대로 사는 모드만 true", () => {
    expect(isActiveWindowMode("interval")).toBe(true);
    expect(isActiveWindowMode("standby")).toBe(true);
    expect(isActiveWindowMode("once")).toBe(false);
    expect(isActiveWindowMode("weekly")).toBe(false);
  });
});
