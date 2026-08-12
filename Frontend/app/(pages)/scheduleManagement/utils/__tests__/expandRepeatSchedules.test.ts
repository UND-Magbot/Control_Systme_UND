import { describe, it, expect } from "vitest";
import { expandRepeatSchedules } from "@/app/(pages)/scheduleManagement/utils/expandRepeatSchedules";
import { isActiveWindowMode, isRecurringSeries } from "@/app/lib/scheduleMode";

// 회귀 방지: 예전엔 Repeat="Y"를 ScheduleMode보다 먼저 봐서 standby 가 weekly 로
// 흡수됐고, 운영 시간대 9시간이 30분짜리 점 이벤트로 그려졌다.
// 아래는 개발 DB의 상시대기 레코드(id=176) 형태를 그대로 옮긴 것.
const standby: any = {
  id: 176, RobotName: "R1", WorkName: "상시대기 검증_02", TaskType: "길 안내",
  StartDate: "2026-08-06T09:00:00", EndDate: "2026-08-06T09:00:00", TaskStatus: "대기",
  WayName: "", Repeat: "Y", Repeat_Day: "월,화,수,목,금,토,일", Repeat_End: null,
  ScheduleMode: "standby", ExecutionTime: null,
  ActiveStartTime: "09:00", ActiveEndTime: "18:00", IntervalMinutes: null,
  SeriesStartDate: "2026-08-01", SeriesEndDate: null, SeriesExceptions: null,
};

describe("상시대기 캘린더 확장", () => {
  const from = new Date(2026, 7, 3); // 8/3 월
  const to = new Date(2026, 7, 5, 23, 59); // 8/5 수
  const out = expandRepeatSchedules([standby], from, to);

  it("매칭 요일마다 인스턴스를 만든다", () => {
    expect(out.length).toBe(3);
  });

  it("운영 시간대 밴드(09:00~18:00)로 펼쳐진다 — 30분 점 이벤트가 아니다", () => {
    const first = new Date(out[0].StartDate);
    const last = new Date(out[0].EndDate);
    expect(first.getHours()).toBe(9);
    expect(last.getHours()).toBe(18);
    const durationMin = (last.getTime() - first.getTime()) / 60000;
    expect(durationMin).toBe(540); // 9시간
  });

  it("ScheduleMode 가 standby 로 보존된다 — weekly 로 흡수되지 않는다", () => {
    expect(out.every((e: any) => e.ScheduleMode === "standby")).toBe(true);
  });
});

describe("isActiveWindowMode — 시간 표기를 밴드로 쓸 모드", () => {
  it("interval·standby 는 시작~종료로 표기한다", () => {
    expect(isActiveWindowMode("interval")).toBe(true);
    expect(isActiveWindowMode("standby")).toBe(true);
  });

  it("once·weekly 는 시작 시각만 표기한다", () => {
    expect(isActiveWindowMode("once")).toBe(false);
    expect(isActiveWindowMode("weekly")).toBe(false);
  });

  it("모드가 비어 있어도 터지지 않는다", () => {
    expect(isActiveWindowMode(undefined)).toBe(false);
    expect(isActiveWindowMode(null)).toBe(false);
  });
});

describe("isRecurringSeries — 범위 선택을 물어야 하는가", () => {
  it("하루짜리 시리즈는 묻지 않는다", () => {
    // 개발 DB id=175 형태
    expect(isRecurringSeries({ SeriesStartDate: "2026-08-06", SeriesEndDate: "2026-08-06" })).toBe(false);
  });

  it("무기한이면 묻는다", () => {
    // 개발 DB id=176 형태
    expect(isRecurringSeries({ SeriesStartDate: "2026-08-07", SeriesEndDate: null })).toBe(true);
  });

  it("기간이 하루를 넘으면 묻는다", () => {
    expect(isRecurringSeries({ SeriesStartDate: "2026-04-06", SeriesEndDate: "2026-04-08" })).toBe(true);
  });

  it("하루짜리여도 같은 그룹에 형제가 여럿이면 묻는다", () => {
    expect(isRecurringSeries({
      SeriesStartDate: "2026-04-23", SeriesEndDate: "2026-04-23", SiblingCount: 2,
    })).toBe(true);
  });

  it("정보가 없으면 보수적으로 묻는다 — 안 묻고 전체를 건드리는 쪽이 위험하다", () => {
    expect(isRecurringSeries({})).toBe(true);
  });
});

describe("미래 회차 상태 정규화", () => {
  const base = {
    id: 900,
    WorkName: "매일 순찰",
    RobotName: "R-001",
    TaskType: "patrol",
    WayName: "1층 순회",
    ScheduleMode: "weekly",
    Repeat: "Y",
    Repeat_Day: "월,화,수,목,금,토,일",
    ExecutionTime: "09:00",
    SeriesStartDate: null,
    SeriesEndDate: null,
    SeriesExceptions: null,
    SeriesGroupId: null,
  };

  const rangeOf = (fromDays: number, toDays: number) => {
    const s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() + fromDays);
    const e = new Date(); e.setHours(23, 59, 59, 0); e.setDate(e.getDate() + toDays);
    return [s, e] as const;
  };

  const iso = (offsetDays: number, hhmm = "09:00") => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const [h, m] = hhmm.split(":");
    d.setHours(Number(h), Number(m), 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${hhmm}:00`;
  };

  it("오늘이 '오류'여도 내일 회차는 '대기'로 보인다", () => {
    const [rs, re] = rangeOf(0, 3);
    const out = expandRepeatSchedules(
      [{ ...base, TaskStatus: "오류", StartDate: iso(0), EndDate: iso(0, "18:00") } as any],
      rs as Date, re as Date,
    );
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const future = out.filter((e) => {
      const d = new Date(e._virtualDate); d.setHours(0, 0, 0, 0);
      return d.getTime() > today.getTime();
    });
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((e) => e.TaskStatus === "대기")).toBe(true);
  });

  it("오늘 회차의 상태는 건드리지 않는다", () => {
    const [rs, re] = rangeOf(0, 1);
    const out = expandRepeatSchedules(
      [{ ...base, TaskStatus: "진행중", StartDate: iso(0), EndDate: iso(0, "18:00") } as any],
      rs as Date, re as Date,
    );
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todays = out.filter((e) => {
      const d = new Date(e._virtualDate); d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime();
    });
    expect(todays.some((e) => e.TaskStatus === "진행중")).toBe(true);
  });

  it("취소된 회차는 미래여도 '취소'로 남는다", () => {
    const [rs, re] = rangeOf(0, 3);
    const out = expandRepeatSchedules(
      [{ ...base, TaskStatus: "취소", StartDate: iso(0), EndDate: iso(0, "18:00") } as any],
      rs as Date, re as Date,
    );
    expect(out.every((e) => e.TaskStatus === "취소")).toBe(true);
  });
});
