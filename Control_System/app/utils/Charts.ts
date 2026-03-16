import type { RobotRowData, DonutCommonInfo } from '@/app/type';
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";


type DonutCommonProps = {
    robots : RobotRowData[];
}

function makeFixedPercents(counts: number[]): number[] {
  const total = counts.reduce((sum, v) => sum + v, 0);

  // 값이 없거나 합계가 0이면 모두 0%
  if (total <= 0 || counts.length === 0) {
    return counts.map(() => 0);
  }

  // 각 값의 비율을 그대로 계산 (소수점 1자리까지)
  return counts.map((v) => {
    const percent = (v / total) * 100;
    return Number(percent.toFixed(1));   // 예: 33.333 → 33.3
  });
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
    typeCount[r.type] = (typeCount[r.type] || 0) + 1;
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