import { describe, it, expect } from "vitest";
import { resolveOccurrenceStatus, isFutureOccurrence } from "@/app/lib/occurrenceStatus";

const today = new Date(2026, 7, 7);          // 2026-08-07
const tomorrow = new Date(2026, 7, 8);
const yesterday = new Date(2026, 7, 6);

describe("resolveOccurrenceStatus", () => {
  it("미래 회차는 시리즈가 진행중이어도 '대기'", () => {
    expect(resolveOccurrenceStatus("진행중", tomorrow, today)).toBe("대기");
  });

  it("미래 회차는 시리즈가 오류여도 '대기' — 오늘 실패가 내일을 물들이지 않는다", () => {
    expect(resolveOccurrenceStatus("오류", tomorrow, today)).toBe("대기");
  });

  it("오늘 회차는 시리즈 상태를 그대로 쓴다", () => {
    expect(resolveOccurrenceStatus("진행중", today, today)).toBe("진행중");
    expect(resolveOccurrenceStatus("오류", today, today)).toBe("오류");
  });

  it("지난 회차도 지금은 시리즈 상태를 쓴다 (ScheduleRun 도입 전까지)", () => {
    expect(resolveOccurrenceStatus("진행중", yesterday, today)).toBe("진행중");
  });

  it("'취소'는 미래여도 유지된다 — 사람이 그 날짜를 콕 집어 껐다", () => {
    expect(resolveOccurrenceStatus("취소", tomorrow, today)).toBe("취소");
  });

  it("회차 날짜를 모르면 시리즈 상태를 그대로 돌려준다", () => {
    expect(resolveOccurrenceStatus("진행중", null, today)).toBe("진행중");
    expect(resolveOccurrenceStatus("진행중", undefined, today)).toBe("진행중");
  });

  it("YYYY-MM-DD 문자열도 받는다 (상세 모달의 targetDate)", () => {
    expect(resolveOccurrenceStatus("진행중", "2026-08-08", today)).toBe("대기");
    expect(resolveOccurrenceStatus("진행중", "2026-08-07", today)).toBe("진행중");
  });
});

describe("isFutureOccurrence", () => {
  it("내일은 미래, 오늘·어제는 아니다", () => {
    expect(isFutureOccurrence(tomorrow, today)).toBe(true);
    expect(isFutureOccurrence(today, today)).toBe(false);
    expect(isFutureOccurrence(yesterday, today)).toBe(false);
  });

  it("날짜가 없으면 미래가 아니다 (차단 규칙을 느슨하게 만들지 않는다)", () => {
    expect(isFutureOccurrence(null, today)).toBe(false);
  });
});
