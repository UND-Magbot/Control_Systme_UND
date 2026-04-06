import type { RobotRowData, DonutCommonInfo } from '@/app/type';
import type { RobotTypeCount, TaskCounts, TimeMinutes, ErrorCounts } from '@/app/lib/statisticsApi';
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";


type DonutCommonProps = {
    robots : RobotRowData[];
}

export type BarChartItem = {
  label: string;
  value: number;
  percent: number;
  displayValue?: string;
  color?: string;
};

/**
 * Largest Remainder Method — 합계 100.0% 보장
 */
function makeFixedPercents(counts: number[]): number[] {
  const total = counts.reduce((sum, v) => sum + v, 0);
  if (total <= 0 || counts.length === 0) {
    return counts.map(() => 0);
  }

  const raw = counts.map(v => (v / total) * 100);
  const floored = raw.map(v => Math.floor(v * 10) / 10);

  // 부족분을 0.1% 단위로 계산
  let remainder = Math.round((100 - floored.reduce((s, v) => s + v, 0)) * 10);

  // 나머지가 큰 순서로 0.1%씩 보정
  const remainders = raw.map((v, i) => ({ i, r: v - floored[i] }));
  remainders.sort((a, b) => b.r - a.r);

  for (const { i } of remainders) {
    if (remainder <= 0) break;
    floored[i] = Math.round((floored[i] + 0.1) * 10) / 10;
    remainder--;
  }

  return floored;
}


// 로봇 타입별 대수 도넛 데이터
export function buildRobotTypeDonut({ robots }: DonutCommonProps) {
  const typeCount: Record<string, number> = {};

  // 0개일 때 기본 그래프 유지
  if (robots.length === 0) {
    return [
      { id: 1, label: "QUADRUPED", value: 0, percent: 0, displayValue: "0 units" },
      { id: 2, label: "COBOT",     value: 0, percent: 0, displayValue: "0 units" },
      { id: 3, label: "AMR",       value: 0, percent: 0, displayValue: "0 units" },
      { id: 4, label: "HUMANOID",  value: 0, percent: 0, displayValue: "0 units" },
    ];
  }

  robots.forEach(r => {
    const type = r.type || "UNKNOWN";
    typeCount[type] = (typeCount[type] || 0) + 1;
  });

  const total = robots.length;

  return Object.entries(typeCount).map(([type, count], idx) => ({
    id: idx + 1,
    label: type,
    value: count,
    percent: Number(((count / total) * 100).toFixed(1)),
    displayValue: `${count}`,
  }));
}

// 작업/충전/대기 시간 도넛 데이터
export function buildTimeDonut({ robots }: DonutCommonProps): DonutCommonInfo[] {

  let operating = 0;
  let standby = 0;
  let charging = 0;
  let docking = 0;

  robots.forEach((r) => {
    operating += r.tasks.reduce((sum, t) => sum + t.taskTime, 0);
    standby += r.waitingTime ?? 0;
    charging += r.chargingTime ?? 0;
    docking += r.dockingTime ?? 0;
  });

  const items: { label: string; value: number }[] = [
    { label: "Operating", value: operating },
    { label: "Standby", value: standby },
    { label: "Charging", value: charging },
    { label: "Docking", value: docking },
  ];

  const values = items.map((i) => i.value);
  const percents = makeFixedPercents(values);

  return items.map((item, idx) => ({
    id: idx + 1,
    label: item.label,
    value: item.value,
    percent: percents[idx],
    displayValue: convertMinutesToText(item.value), // 예: "298h 42m"
  }));
}

// 오류 종류별 건수 도넛 데이터
export function buildErrorDonut({ robots }: DonutCommonProps): DonutCommonInfo[] {
  
  const errorCounts: Record<string, number> = {
    network: 0,
    fail: 0,
    etc: 0,
    mapping: 0,
  };

  // 2) 로봇들의 에러 누적
  robots.forEach((r) => {
    r.errors.forEach((e) => {
      if (errorCounts[e.errorType] === undefined) {
        // 혹시 정의되지 않은 에러 타입이 오면 동적으로 추가
        errorCounts[e.errorType] = 0;
      }
      errorCounts[e.errorType] += e.count;
    });
  });

  const entries = Object.entries(errorCounts);
  const values = entries.map(([_, count]) => count);
  const percents = makeFixedPercents(values);

  return entries.map(([errorType, count], idx) => ({
    id: idx + 1,
    label: errorType,          // 예: "network", "fail", "etc"
    value: count,
    percent: percents[idx],
    displayValue: `${count}`,
  }));
}


// 작업 상태별 건수 도넛 데이터
export function buildTaskCountDonut({ robots }: DonutCommonProps): DonutCommonInfo[] {
  // 기본 작업 타입 초기화
  const taskCounts: Record<string, number> = {
    delivery: 0,
    monitoring: 0,
    patrol: 0,
    facility_inspection: 0,
  };

  // 실제 로봇 task 누적
  robots.forEach((r) => {
    r.tasks.forEach((t) => {
      if (taskCounts[t.taskType] === undefined) {
        // 혹시 새로운 taskType이 들어오면 자동 추가
        taskCounts[t.taskType] = 0;
      }
      taskCounts[t.taskType] += 1;
    });
  });

  const entries = Object.entries(taskCounts);
  const values = entries.map(([_, count]) => count);
  const percents = makeFixedPercents(values);

  return entries.map(([taskType, count], idx) => ({
    id: idx + 1,
    label: taskType,              // 예: "delivery"
    value: count,
    percent: percents[idx],       // 1자리 소수, 합계 100.0
    displayValue: `${count}`,
  }));
}


// ══════════════════════════════════════════════════
// API 응답 기반 변환 함수 (통계 페이지용)
// ══════════════════════════════════════════════════

const TASK_LABEL_KOR: Record<string, string> = {
  completed: "완료",
  failed: "오류",
  cancelled: "취소",
};

const TASK_COLOR: Record<string, string> = {
  completed: "#77a251",
  failed: "#e06b73",
  cancelled: "#8b8fa3",
};

const TASK_ORDER = ["completed", "failed", "cancelled"];

const ERROR_LABEL_KOR: Record<string, string> = {
  network: "네트워크",
  navigation: "네비게이션",
  battery: "배터리",
  etc: "기타",
};

const TIME_LABEL_KOR: Record<string, string> = {
  operating: "운행시간",
  charging: "충전시간",
  standby: "대기시간",
};

const ROBOT_TYPE_KOR: Record<string, string> = {
  QUADRUPED: "4족 보행",
  COBOT: "협동 로봇",
  AMR: "자율주행",
  HUMANOID: "휴머노이드",
};

export function buildRobotTypeDonutFromApi(types: RobotTypeCount[]): DonutCommonInfo[] {
  if (!types || types.length === 0) {
    return [
      { id: 1, label: "QUADRUPED", value: 0, percent: 0, displayValue: "0" },
      { id: 2, label: "COBOT",     value: 0, percent: 0, displayValue: "0" },
      { id: 3, label: "AMR",       value: 0, percent: 0, displayValue: "0" },
      { id: 4, label: "HUMANOID",  value: 0, percent: 0, displayValue: "0" },
    ];
  }

  const values = types.map(t => t.count);
  const percents = makeFixedPercents(values);

  return types.map((t, idx) => ({
    id: idx + 1,
    label: t.type,
    value: t.count,
    percent: percents[idx],
    displayValue: `${t.count}`,
  }));
}

export function buildRobotTypeBarFromApi(types: RobotTypeCount[]): BarChartItem[] {
  const allTypes = ["QUADRUPED", "COBOT", "AMR", "HUMANOID"];
  const typeMap: Record<string, number> = {};
  allTypes.forEach(t => { typeMap[t] = 0; });
  (types ?? []).forEach(t => { typeMap[t.type] = t.count; });

  const entries = allTypes.map(t => ({ key: t, value: typeMap[t] }));
  const values = entries.map(e => e.value);
  const percents = makeFixedPercents(values);

  return entries
    .map((e, idx) => ({
      label: ROBOT_TYPE_KOR[e.key] ?? e.key,
      value: e.value,
      percent: percents[idx],
    }))
    .sort((a, b) => b.value - a.value);
}

export function buildTaskBarFromApi(tasks: TaskCounts): BarChartItem[] {
  const ordered = TASK_ORDER.map(key => ({ key, value: (tasks as Record<string, number>)[key] ?? 0 }));
  const values = ordered.map(e => e.value);
  const percents = makeFixedPercents(values);

  return ordered.map((e, idx) => ({
    label: TASK_LABEL_KOR[e.key] ?? e.key,
    value: e.value,
    percent: percents[idx],
    color: TASK_COLOR[e.key],
  }));
}

export function buildTimeDonutFromApi(time: TimeMinutes): DonutCommonInfo[] {
  const entries = Object.entries(time) as [string, number][];
  const values = entries.map(([, v]) => v);
  const percents = makeFixedPercents(values);

  return entries.map(([key, value], idx) => ({
    id: idx + 1,
    label: TIME_LABEL_KOR[key] ?? key,
    value,
    percent: percents[idx],
    displayValue: convertMinutesToText(value),
  }));
}

export function buildTimeBarFromApi(time: TimeMinutes): BarChartItem[] {
  const entries = Object.entries(time) as [string, number][];
  const values = entries.map(([, v]) => v);
  const percents = makeFixedPercents(values);

  return entries
    .map(([key, value], idx) => ({
      label: TIME_LABEL_KOR[key] ?? key,
      value,
      percent: percents[idx],
      displayValue: convertMinutesToText(value),
    }))
    .sort((a, b) => b.value - a.value);
}

export function buildErrorBarFromApi(errors: ErrorCounts): BarChartItem[] {
  const entries = Object.entries(errors) as [string, number][];
  const values = entries.map(([, v]) => v);
  const percents = makeFixedPercents(values);

  return entries
    .map(([key, value], idx) => ({
      label: ERROR_LABEL_KOR[key] ?? key,
      value,
      percent: percents[idx],
    }))
    .sort((a, b) => b.value - a.value);
}