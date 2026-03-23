import type { SelectOption } from "@/app/components/select/CustomSelect";

export type ScheduleFormState = {
  selectedRobot: SelectOption | null;
  taskName: string;
  selectedWorkType: SelectOption | null;
  selectedWorkPath: SelectOption | null;
  startDate: Date;
  endDate: Date;
  startAmpm: string | null;
  startHour: string | null;
  startMin: string | null;
  endAmpm: string | null;
  endHour: string | null;
  endMin: string | null;
  repeatEnabled: boolean;
  repeatDays: string[];
  repeatEndType: "none" | "date";
  repeatEndDate: string;
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

export function validateScheduleForm(form: ScheduleFormState): FieldErrors {
  const errors: FieldErrors = {};

  // 로봇 필수
  if (!form.selectedRobot) {
    errors.robot = "로봇을 선택하세요.";
  }

  // 작업명 필수 + 바이트 검증
  if (!form.taskName.trim()) {
    errors.taskName = "작업명을 입력하세요.";
  } else if (getByteLength(form.taskName) > 50) {
    errors.taskName = "작업명은 50바이트를 초과할 수 없습니다.";
  }

  // 작업유형 필수
  if (!form.selectedWorkType) {
    errors.workType = "작업유형을 선택하세요.";
  }

  // 시간 필드 필수 검증
  if (!form.startAmpm) {
    errors.startAmpm = "시작 오전/오후를 선택하세요.";
  }
  if (!form.startHour) {
    errors.startHour = "시작 시간을 선택하세요.";
  }
  if (!form.startMin) {
    errors.startMin = "시작 분을 선택하세요.";
  }
  if (!form.endAmpm) {
    errors.endAmpm = "종료 오전/오후를 선택하세요.";
  }
  if (!form.endHour) {
    errors.endHour = "종료 시간을 선택하세요.";
  }
  if (!form.endMin) {
    errors.endMin = "종료 분을 선택하세요.";
  }

  // 시작/종료 일시 비교 (시간 필드가 모두 있을 때만)
  if (form.startAmpm && form.startHour && form.startMin && form.endAmpm && form.endHour && form.endMin) {
    const startDT = makeDateTime(form.startDate, form.startAmpm, form.startHour, form.startMin);
    const endDT = makeDateTime(form.endDate, form.endAmpm, form.endHour, form.endMin);

    if (startDT >= endDT) {
      errors.dateTime = "시작 일시가 종료 일시보다 같거나 늦습니다.";
    }

    // 과거 날짜 방지 (반복 일정 제외)
    if (!form.repeatEnabled) {
      const now = new Date();
      const startDate = new Date(startDT.replace(" ", "T"));
      if (startDate < now) {
        errors.pastDate = "시작 일시가 현재 시각보다 이전입니다.";
      }
    }
  }

  // 작업경로 필수
  if (!form.selectedWorkPath) {
    errors.workPath = "작업경로를 선택하세요.";
  }

  // 반복 설정 검증
  if (form.repeatEnabled) {
    if (form.repeatDays.length === 0) {
      errors.repeatDays = "반복 요일을 1개 이상 선택하세요.";
    }

    if (form.repeatEndType === "date") {
      const repeatEnd = new Date(form.repeatEndDate);
      if (repeatEnd < form.startDate) {
        errors.repeatEndDate = "반복 종료일이 시작일보다 빠릅니다.";
      }
      if (repeatEnd < form.endDate) {
        errors.repeatEndDate = "반복 종료일이 종료일보다 빠릅니다.";
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
