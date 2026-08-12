// 작업 유형(TaskType) 단일 출처.
// WayInfo(경로) · Schedule(작업)의 TaskType 값과 화면 표시 라벨을 여기서 관리한다.
// 시나리오 기반 3종: 길 안내 / 물품 운반 / 순찰·점검.
// (충전 복귀는 작업 유형이 아니라 로봇 자율동작·즉시명령으로 별도 처리 — 여기 포함하지 않는다.)

export type WorkType = {
  id: number;
  label: string;
};

// 화면 드롭다운·필터·저장에 쓰는 표준 작업 유형.
// label 이 곧 DB에 저장되는 TaskType 값이다(현행 아키텍처 유지).
export const WORK_TYPES: WorkType[] = [
  { id: 1, label: "길 안내" },
  { id: 2, label: "물품 운반" },
  { id: 3, label: "순찰·점검" },
];

// 작업 등록/수정 모달의 작업유형 드롭다운에서 "전체(리셋)" 옵션으로 사용.
// 선택 시 내부 상태를 null/""로 변환해 경로 필터가 초기화된다.
export const WORK_TYPE_ALL: WorkType = { id: 0, label: "전체" };

// 구 플레이스홀더(task1/2/3/test) → 현행 작업유형 라벨.
// 기존 DB에 저장된 값을 화면·필터에서 현행 유형으로 통일한다.
const LEGACY_TASK_TYPE_ALIASES: Record<string, string> = {
  task1: "길 안내",
  task2: "물품 운반",
  task3: "순찰·점검",
  test: "길 안내",
};

/**
 * 저장된 TaskType 원시값을 화면 표시·필터 비교용 표준 라벨로 정규화한다.
 * - 현행 유형이면 그대로
 * - 구값(task1 등)이면 현행 라벨로 매핑
 * - 그 외 알 수 없는 값이면 원문을 그대로 반환(정보 유실 방지)
 */
export function resolveTaskTypeLabel(raw?: string | null): string {
  if (!raw) return "";
  const v = raw.trim();
  if (WORK_TYPES.some((t) => t.label === v)) return v;
  return LEGACY_TASK_TYPE_ALIASES[v] ?? v;
}
