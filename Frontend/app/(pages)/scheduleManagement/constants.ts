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

// 작업 등록/수정 모달의 작업유형 드롭다운에서 "전체(리셋)" 옵션으로 사용.
// 선택 시 내부 상태를 null/""로 변환해 경로 필터가 초기화됨.
// 저장 시 유효성 검사가 null을 거부하므로 최종 저장 직전엔 반드시 구체 유형이 선택되어 있어야 함.
export const WORK_TYPE_ALL: WorkType = { id: 0, label: "전체" };

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

// 공유 CustomSelect용 옵션 (TimePicker, ScheduleDetail 등에서 공통 사용)
export const AMPM_OPTIONS: { id: string; label: string }[] =
  AMPM.map((v) => ({ id: v, label: v }));

export const HOUR_OPTIONS: { id: string; label: string }[] =
  HOURS.map((h) => {
    const s = String(h).padStart(2, "0");
    return { id: s, label: s };
  });

export const MINUTE_OPTIONS: { id: string; label: string }[] =
  MINUTES.map((m) => ({ id: m, label: m }));

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
