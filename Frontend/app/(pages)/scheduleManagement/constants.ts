// 작업관리 공통 상수 및 타입

// 작업 유형(TaskType)은 단일 출처 @/app/lib/taskType 에서 관리한다.
// 여러 화면(대시보드 맵·운영관리·맵관리·작업관리)이 공유하므로 재수출한다.
// 저장 시 유효성 검사가 null을 거부하므로 최종 저장 직전엔 반드시 구체 유형이 선택되어 있어야 함.
export {
  WORK_TYPES,
  WORK_TYPE_ALL,
  resolveTaskTypeLabel,
  type WorkType,
} from "@/app/lib/taskType";

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

// 스케줄 모드는 단일 출처 @/app/lib/scheduleMode 에서 관리한다.
// 대시보드·운영관리도 같은 라벨을 써야 하므로 재수출한다.
export {
  SCHEDULE_MODES,
  SCHEDULE_MODE_LABELS,
  SCHEDULE_MODE_SHORT_LABELS,
  resolveScheduleMode,
  getScheduleModeLabel,
  isActiveWindowMode,
  type ScheduleMode,
} from "@/app/lib/scheduleMode";

// 상시 대기 — 트리거가 '시각'이 아니라 '사람의 호출'이라 경로 대신 대기 장소로 움직인다
export const STANDBY_TRIGGERS = [
  { id: "mic", label: "마이크 (자동 청취)" },
  { id: "button", label: "관제 · 태블릿 버튼" },
] as const;
export type StandbyTrigger = (typeof STANDBY_TRIGGERS)[number]["id"];

export const INTERVAL_PRESETS = [5, 10, 15, 20, 30, 60] as const;
