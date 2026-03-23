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

export const MINUTES = ["00", "10", "20", "30", "40", "50"] as const;

export const DOWS = ["월", "화", "수", "목", "금", "토", "일"] as const;
export type Dow = (typeof DOWS)[number];
