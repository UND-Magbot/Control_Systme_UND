import type { SelectOption } from "@/app/components/select/CustomSelect";
import type { ScheduleMode } from "../constants";

export type ScheduleFormState = {
  selectedRobot: SelectOption | null;
  taskName: string;
  selectedWorkType: SelectOption | null;
  selectedWorkPath: SelectOption | null;

  scheduleMode: ScheduleMode;

  // once 모드
  startDate: Date;
  startAmpm: string | null;
  startHour: string | null;
  startMin: string | null;

  // weekly 모드
  repeatDays: string[];

  // interval 모드
  activeStartAmpm: string | null;
  activeStartHour: string | null;
  activeStartMin: string | null;
  activeEndAmpm: string | null;
  activeEndHour: string | null;
  activeEndMin: string | null;
  intervalMinutes: number | null;
  intervalRepeatDays: string[];

  // weekly + interval 공통
  seriesStartDate: string; // "YYYY-MM-DD"
  seriesEndType: "none" | "date";
  seriesEndDate: string; // "YYYY-MM-DD"
};

export type FieldErrors = Record<string, string>;

export function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

export function makeDateTime(
  date: Date,
  ampm: string,
  hour: string,
  minute: string
): string {
  let h = Number(hour);
  if (ampm === "오후" && h !== 12) h += 12;
  if (ampm === "오전" && h === 12) h = 0;

  const d = new Date(date);
  d.setHours(h, Number(minute), 0, 0);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:00`;
}

/** 오전/오후 + 시 + 분 → "HH:MM" (24시간) */
export function makeTimeString(ampm: string, hour: string, minute: string): string {
  let h = Number(hour);
  if (ampm === "오후" && h !== 12) h += 12;
  if (ampm === "오전" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${minute}`;
}

/** "HH:MM" (24시간) → { ampm, hour, minute } */
export function parseTimeString(timeStr: string): { ampm: string; hour: string; minute: string } {
  const [hh, mm] = timeStr.split(":");
  let h = Number(hh);
  let ampm = "오전";
  if (h >= 12) {
    ampm = "오후";
    if (h > 12) h -= 12;
  }
  if (h === 0) h = 12;
  return { ampm, hour: String(h), minute: mm };
}

export function validateScheduleForm(form: ScheduleFormState): FieldErrors {
  const errors: FieldErrors = {};

  // 공통 필수
  if (!form.selectedRobot) {
    errors.robot = "로봇을 선택하세요.";
  }
  if (!form.taskName.trim()) {
    errors.taskName = "작업명을 입력하세요.";
  } else if (getByteLength(form.taskName) > 50) {
    errors.taskName = "작업명은 50바이트를 초과할 수 없습니다.";
  }
  if (!form.selectedWorkType) {
    errors.workType = "작업유형을 선택하세요.";
  }
  if (!form.selectedWorkPath) {
    errors.workPath = "작업경로를 선택하세요.";
  }

  // 모드별 검증
  if (form.scheduleMode === "once") {
    if (!form.startAmpm) errors.startAmpm = "오전/오후를 선택하세요.";
    if (!form.startHour) errors.startHour = "시간을 선택하세요.";
    if (!form.startMin) errors.startMin = "분을 선택하세요.";

    // 과거 날짜 방지
    if (form.startAmpm && form.startHour && form.startMin) {
      const startDT = makeDateTime(form.startDate, form.startAmpm, form.startHour, form.startMin);
      const now = new Date();
      const startDate = new Date(startDT.replace(" ", "T"));
      if (startDate < now) {
        errors.pastDate = "실행 일시가 현재 시각보다 이전입니다.";
      }
    }
  } else if (form.scheduleMode === "weekly") {
    if (form.repeatDays.length === 0) {
      errors.repeatDays = "반복 요일을 1개 이상 선택하세요.";
    }
    if (form.seriesEndType === "date" && form.seriesEndDate && form.seriesStartDate) {
      if (form.seriesEndDate < form.seriesStartDate) {
        errors.seriesEndDate = "종료일이 시작일보다 빠릅니다.";
      }
    }
  } else if (form.scheduleMode === "interval") {
    if (!form.activeStartAmpm) errors.activeStartAmpm = "오전/오후를 선택하세요.";
    if (!form.activeStartHour) errors.activeStartHour = "시간을 선택하세요.";
    if (!form.activeStartMin) errors.activeStartMin = "분을 선택하세요.";
    if (!form.activeEndAmpm) errors.activeEndAmpm = "오전/오후를 선택하세요.";
    if (!form.activeEndHour) errors.activeEndHour = "시간을 선택하세요.";
    if (!form.activeEndMin) errors.activeEndMin = "분을 선택하세요.";
    if (!form.intervalMinutes || form.intervalMinutes < 1) {
      errors.intervalMinutes = "반복 간격을 1분 이상 입력하세요.";
    }
    if (form.seriesEndType === "date" && form.seriesEndDate && form.seriesStartDate) {
      if (form.seriesEndDate < form.seriesStartDate) {
        errors.seriesEndDate = "종료일이 시작일보다 빠릅니다.";
      }
    }
  }

  return errors;
}

export function validateSingleField(
  fieldName: string,
  form: ScheduleFormState
): string | null {
  const allErrors = validateScheduleForm(form);
  return allErrors[fieldName] ?? null;
}
