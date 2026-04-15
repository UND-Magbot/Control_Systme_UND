import { minToHm, toAmpmHour, pad2 } from './datetime';

export type PathDetail = {
  order: number;
  label: string;
};

export type PathRow = {
  id: number;
  pathName: string;      // 셀렉트에 표시될 경로명
  details: PathDetail[]; // 상세 경로
};

export type FormState = {
  robotNo: string;
  title: string;
  workType: string; // label
  workStatus: string; // label

  // (목업) 날짜 텍스트. 실제 DatePicker 도입 전까지 문자열로 유지
  dateText: string;
  // (목업) 요일 텍스트. 반복 설정을 실제로 붙이면 구조화 권장
  dowText: string;

  startAmpm: '오전' | '오후';
  startHour: number; // 1-12
  startMin: number; // 0-59

  endAmpm: '오전' | '오후';
  endHour: number; // 1-12
  endMin: number; // 0-59

  // 작업경로
  pathId: number | null;
  pathName: string;
  pathDetails: PathDetail[];
  pathOrder: string;

  // 3모드 스케줄
  scheduleMode: 'once' | 'weekly' | 'interval';

  // 반복 설정 (weekly)
  repeatEnabled: boolean;
  repeatDays: Array<'월' | '화' | '수' | '목' | '금' | '토' | '일'>;
  repeatEveryday: boolean;
  repeatEndType: 'none' | 'date';
  repeatEndDate: string;                 // YYYY-MM-DD

  // weekly 다중 시각
  executionTimes: string[];              // ["10:58","11:02","11:05"]

  // interval 모드
  intervalMinutes: number | null;
  activeStartTime: string;               // "HH:MM"
  activeEndTime: string;                 // "HH:MM"
  intervalRepeatDays: Array<'월' | '화' | '수' | '목' | '금' | '토' | '일'>;

  // 시리즈 공통
  seriesStartDate: string;               // "YYYY-MM-DD"
  seriesEndDate: string;                 // "YYYY-MM-DD"
};

export type ScheduleFormSeed = {
  robotNo: string;
  title: string;
  robotType: string;
  startMin: number;
  endMin: number;
};

export function buildInitialForm(event: ScheduleFormSeed): FormState {
  const start = minToHm(event.startMin);
  const end = minToHm(event.endMin);

  const startA = toAmpmHour(start.h);
  const endA = toAmpmHour(end.h);

  return {
    robotNo: event.robotNo,
    title: event.title,
    workType: event.robotType,
    workStatus: '',

    dateText: '',
    dowText: '',

    startAmpm: startA.ampm,
    startHour: startA.h12,
    startMin: start.m,

    endAmpm: endA.ampm,
    endHour: endA.h12,
    endMin: end.m,

    pathId: null,
    pathName: '',
    pathDetails: [],
    pathOrder: '',

    scheduleMode: 'once',

    repeatEnabled: false,
    repeatDays: [],
    repeatEveryday: false,
    repeatEndType: 'none',
    repeatEndDate: '',

    executionTimes: [],

    intervalMinutes: null,
    activeStartTime: '09:00',
    activeEndTime: '18:00',
    intervalRepeatDays: [],

    seriesStartDate: '',
    seriesEndDate: '',
  };
}

export function formatTimeRangeFromForm(f: FormState): string {
  return `${f.startAmpm} ${pad2(f.startHour)}:${pad2(f.startMin)} ~ ${f.endAmpm} ${pad2(
    f.endHour
  )}:${pad2(f.endMin)}`;
}
