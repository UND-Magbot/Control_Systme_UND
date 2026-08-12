// 스케줄 반복 모드(ScheduleMode) 단일 출처.
// 작업관리·대시보드·운영관리가 같은 작업을 같은 이름으로 표시하도록 여기서만 관리한다.
// (이전엔 화면마다 삼항식이 하드코딩돼 있어 상시대기가 '주기반복'·'단일'로 다르게 보였다.)

export const SCHEDULE_MODES = ["once", "weekly", "interval", "standby"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

// 등록·수정 화면의 모드 선택용 (문장형)
export const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  once: "단일 실행",
  weekly: "요일 반복",
  interval: "주기 반복",
  standby: "상시 대기",
};

// 카드·배지·목록용 (축약형)
export const SCHEDULE_MODE_SHORT_LABELS: Record<ScheduleMode, string> = {
  once: "단일",
  weekly: "요일반복",
  interval: "주기반복",
  standby: "상시대기",
};

/** ScheduleMode 판정에 필요한 최소 필드. 화면마다 스케줄 타입이 달라 구조적 타입으로 받는다. */
export type ScheduleModeSource = {
  ScheduleMode?: string | null;
  Repeat?: string | null;
};

export function isScheduleMode(v: string): v is ScheduleMode {
  return (SCHEDULE_MODES as readonly string[]).includes(v);
}

/**
 * 저장된 ScheduleMode를 표준 모드로 정규화한다.
 * ScheduleMode가 비어 있는 구 데이터는 Repeat 플래그로 판정한다.
 */
export function resolveScheduleMode(s: ScheduleModeSource): string {
  const raw = (s.ScheduleMode || "").trim();
  if (raw) return raw;
  return s.Repeat === "Y" ? "weekly" : "once";
}

/**
 * 운영 시간대(ActiveStartTime~ActiveEndTime)로 사는 모드인가.
 * 시각 하나가 아니라 "언제부터 언제까지"가 수명이라 시간 표기를 밴드로 한다.
 */
export function isActiveWindowMode(mode: string | null | undefined): boolean {
  return mode === "interval" || mode === "standby";
}

/**
 * 회차가 여럿인 시리즈인가 — 수정·삭제 시 범위(이 회차/이후 모든/전체)를 물어야 하는지 판정.
 * 하루짜리 시리즈는 세 선택지가 전부 같은 뜻이라 묻는 것 자체가 군더더기다.
 * 정보가 부족하면 보수적으로 true(=묻는다) — 안 묻고 전체를 건드리는 쪽이 더 위험하다.
 */
export function isRecurringSeries(s: {
  SeriesStartDate?: string | null;
  SeriesEndDate?: string | null;
  SiblingCount?: number | null;
}): boolean {
  if ((s.SiblingCount ?? 0) > 1) return true;   // 같은 그룹에 분할된 회차가 여럿
  const start = s.SeriesStartDate ?? null;
  const end = s.SeriesEndDate ?? null;
  if (!start) return true;                      // 시작일 모름
  if (!end) return true;                        // 무기한
  return end !== start;
}

/**
 * 모드 표시 라벨. long=true면 문장형("주기 반복"), 아니면 축약형("주기반복").
 * 알 수 없는 모드는 원문을 그대로 반환한다 — 아는 값으로 흡수하면 오표시가 된다.
 */
export function getScheduleModeLabel(mode: string, long = false): string {
  if (!isScheduleMode(mode)) return mode || SCHEDULE_MODE_SHORT_LABELS.once;
  return long ? SCHEDULE_MODE_LABELS[mode] : SCHEDULE_MODE_SHORT_LABELS[mode];
}
