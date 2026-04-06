// 작업관리 공통 상수 및 타입

export type WorkType = {
  id: number;
  label: string;
};

export const WORK_TYPES: WorkType[] = [
  { id: 1, label: "task1" },
  { id: 2, label: "task2" },
  { id: 3, label: "task3" },
];

export type WorkStatus = {
  id: number;
  label: string;
};

export const WORK_STATUS: WorkStatus[] = [
  { id: 1, label: "대기" },
  { id: 2, label: "진행중" },
  { id: 3, label: "완료" },
  { id: 4, label: "취소" },
];

export const AMPM = ["오전", "오후"] as const;

export const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1~12

export const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

export const DOWS = ["월", "화", "수", "목", "금", "토", "일"] as const;
export type Dow = (typeof DOWS)[number];

// 스케줄 모드
export const SCHEDULE_MODES = ["once", "weekly", "interval"] as const;
export type ScheduleMode = (typeof SCHEDULE_MODES)[number];

export const SCHEDULE_MODE_LABELS: Record<ScheduleMode, string> = {
  once: "단일 실행",
  weekly: "요일 반복",
  interval: "주기 반복",
};

export const INTERVAL_PRESETS = [5, 10, 15, 20, 30, 60] as const;
