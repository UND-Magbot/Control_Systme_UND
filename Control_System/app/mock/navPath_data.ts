import type { NavPathSegment } from "@/app/components/map/types";

export type NavPathData = {
  pathId: number;
  robotNo: string;
  segments: NavPathSegment[];
};

/**
 * mockPlaceRows 좌표 기반 네비게이션 경로 mock 데이터
 * pathOrder의 장소들을 실제 좌표로 연결하고 중간 waypoint 포함
 */
export const mockNavPaths: NavPathData[] = [
  // Robot 1 경로 1: 장소명 345 → 중앙 복도 → 장소명 1112 → 장소명 0123 → 장소명 345
  {
    pathId: 1,
    robotNo: "Robot 1",
    segments: [
      {
        from: { x: 66.08, y: 30.12, name: "장소명 345" },
        to: { x: 58.37, y: 21.50, name: "중앙 복도" },
        direction: "two-way",
      },
      {
        from: { x: 58.37, y: 21.50, name: "중앙 복도" },
        to: { x: 71.21, y: 29.81, name: "장소명 1112" },
        direction: "one-way",
        waypoints: [{ x: 65.00, y: 24.00 }],
      },
      {
        from: { x: 71.21, y: 29.81, name: "장소명 1112" },
        to: { x: 50.34, y: 55.46, name: "장소명 0123" },
        direction: "one-way",
        waypoints: [{ x: 62.00, y: 42.00 }],
      },
      {
        from: { x: 50.34, y: 55.46, name: "장소명 0123" },
        to: { x: 66.08, y: 30.12, name: "장소명 345" },
        direction: "one-way",
        waypoints: [{ x: 58.00, y: 40.00 }],
      },
    ],
  },
  // Robot 1 경로 2: 수술실 대기 → 검사실 A → 장소명 0123 → 장소명 1112 → 중앙 복도 → 수술실 대기
  {
    pathId: 2,
    robotNo: "Robot 1",
    segments: [
      {
        from: { x: 62.05, y: 44.18, name: "수술실 대기" },
        to: { x: 64.19, y: 60.60, name: "검사실 A" },
        direction: "one-way",
        waypoints: [{ x: 63.00, y: 52.00 }],
      },
      {
        from: { x: 64.19, y: 60.60, name: "검사실 A" },
        to: { x: 50.34, y: 55.46, name: "장소명 0123" },
        direction: "two-way",
      },
      {
        from: { x: 50.34, y: 55.46, name: "장소명 0123" },
        to: { x: 71.21, y: 29.81, name: "장소명 1112" },
        direction: "one-way",
        waypoints: [{ x: 60.00, y: 42.00 }],
      },
      {
        from: { x: 71.21, y: 29.81, name: "장소명 1112" },
        to: { x: 58.37, y: 21.50, name: "중앙 복도" },
        direction: "one-way",
      },
      {
        from: { x: 58.37, y: 21.50, name: "중앙 복도" },
        to: { x: 62.05, y: 44.18, name: "수술실 대기" },
        direction: "one-way",
        waypoints: [{ x: 60.00, y: 32.00 }],
      },
    ],
  },
  // Robot 2 경로 1: 약국 앞 → 간호 스테이션 → 장소명 22 → 물품 보관실 → 수술실 복도 → 약국 앞
  {
    pathId: 5,
    robotNo: "Robot 2",
    segments: [
      {
        from: { x: 41.77, y: 62.11, name: "약국 앞" },
        to: { x: 59.14, y: 52.77, name: "간호 스테이션" },
        direction: "two-way",
        waypoints: [{ x: 50.00, y: 57.00 }],
      },
      {
        from: { x: 59.14, y: 52.77, name: "간호 스테이션" },
        to: { x: 35.12, y: 64.77, name: "장소명 22" },
        direction: "one-way",
        waypoints: [{ x: 47.00, y: 58.00 }],
      },
      {
        from: { x: 35.12, y: 64.77, name: "장소명 22" },
        to: { x: 33.12, y: 50.32, name: "물품 보관실" },
        direction: "one-way",
      },
      {
        from: { x: 33.12, y: 50.32, name: "물품 보관실" },
        to: { x: 73.53, y: 25.22, name: "수술실 복도" },
        direction: "one-way",
        waypoints: [{ x: 50.00, y: 38.00 }],
      },
      {
        from: { x: 73.53, y: 25.22, name: "수술실 복도" },
        to: { x: 41.77, y: 62.11, name: "약국 앞" },
        direction: "one-way",
        waypoints: [{ x: 55.00, y: 45.00 }],
      },
    ],
  },
  // Robot 3 경로 1: 회의실 → 기계실 입구 → 충전 스테이션 → 장소명 1359 → 검사실 A → 회의실
  {
    pathId: 9,
    robotNo: "Robot 3",
    segments: [
      {
        from: { x: 48.39, y: 35.92, name: "회의실" },
        to: { x: 28.40, y: 40.20, name: "기계실 입구" },
        direction: "one-way",
        waypoints: [{ x: 38.00, y: 37.00 }],
      },
      {
        from: { x: 28.40, y: 40.20, name: "기계실 입구" },
        to: { x: 68.57, y: 20.39, name: "충전 스테이션" },
        direction: "two-way",
        waypoints: [{ x: 45.00, y: 28.00 }],
      },
      {
        from: { x: 68.57, y: 20.39, name: "충전 스테이션" },
        to: { x: 57.09, y: 44.39, name: "장소명 1359" },
        direction: "one-way",
        waypoints: [{ x: 64.00, y: 32.00 }],
      },
      {
        from: { x: 57.09, y: 44.39, name: "장소명 1359" },
        to: { x: 58.99, y: 52.70, name: "검사실 A" },
        direction: "one-way",
      },
      {
        from: { x: 58.99, y: 52.70, name: "검사실 A" },
        to: { x: 48.39, y: 35.92, name: "회의실" },
        direction: "one-way",
        waypoints: [{ x: 52.00, y: 44.00 }],
      },
    ],
  },
  // Robot 4 경로 1: 로비 → 접수처 → 수납창구 → 약국 → 검사실 B → 로비
  {
    pathId: 12,
    robotNo: "Robot 4",
    segments: [
      {
        from: { x: 68.35, y: 61.89, name: "로비" },
        to: { x: 38.72, y: 41.08, name: "접수처" },
        direction: "two-way",
        waypoints: [{ x: 53.00, y: 50.00 }],
      },
      {
        from: { x: 38.72, y: 41.08, name: "접수처" },
        to: { x: 40.42, y: 29.33, name: "수납창구" },
        direction: "one-way",
      },
      {
        from: { x: 40.42, y: 29.33, name: "수납창구" },
        to: { x: 77.43, y: 40.22, name: "약국" },
        direction: "one-way",
        waypoints: [{ x: 58.00, y: 34.00 }],
      },
      {
        from: { x: 77.43, y: 40.22, name: "약국" },
        to: { x: 49.55, y: 58.33, name: "검사실 B" },
        direction: "one-way",
        waypoints: [{ x: 63.00, y: 50.00 }],
      },
      {
        from: { x: 49.55, y: 58.33, name: "검사실 B" },
        to: { x: 68.35, y: 61.89, name: "로비" },
        direction: "one-way",
      },
    ],
  },
  // Robot 5 경로 1: 창고 → 배송대기 → 약품보관실 → 수액 준비실 → 간호 스테이션 → 창고
  {
    pathId: 15,
    robotNo: "Robot 5",
    segments: [
      {
        from: { x: 52.03, y: 37.66, name: "창고" },
        to: { x: 70.57, y: 73.70, name: "배송대기" },
        direction: "one-way",
        waypoints: [{ x: 60.00, y: 55.00 }],
      },
      {
        from: { x: 70.57, y: 73.70, name: "배송대기" },
        to: { x: 52.28, y: 78.43, name: "약품보관실" },
        direction: "two-way",
      },
      {
        from: { x: 52.28, y: 78.43, name: "약품보관실" },
        to: { x: 42.70, y: 53.17, name: "수액 준비실" },
        direction: "one-way",
        waypoints: [{ x: 47.00, y: 65.00 }],
      },
      {
        from: { x: 42.70, y: 53.17, name: "수액 준비실" },
        to: { x: 35.60, y: 26.00, name: "간호 스테이션" },
        direction: "one-way",
        waypoints: [{ x: 39.00, y: 40.00 }],
      },
      {
        from: { x: 35.60, y: 26.00, name: "간호 스테이션" },
        to: { x: 52.03, y: 37.66, name: "창고" },
        direction: "one-way",
        waypoints: [{ x: 44.00, y: 31.00 }],
      },
    ],
  },
  // Robot 6 경로 1: 병동 휴게실 → 3F 복도 서쪽 → 엘리베이터 앞 → 3F 복도 동쪽 → 병동 휴게실
  {
    pathId: 18,
    robotNo: "Robot 6",
    segments: [
      {
        from: { x: 46.15, y: 33.09, name: "병동 휴게실" },
        to: { x: 73.42, y: 56.12, name: "3F 복도 서쪽" },
        direction: "two-way",
        waypoints: [{ x: 60.00, y: 44.00 }],
      },
      {
        from: { x: 73.42, y: 56.12, name: "3F 복도 서쪽" },
        to: { x: 32.83, y: 59.49, name: "엘리베이터 앞" },
        direction: "one-way",
        waypoints: [{ x: 53.00, y: 58.00 }],
      },
      {
        from: { x: 32.83, y: 59.49, name: "엘리베이터 앞" },
        to: { x: 72.83, y: 65.65, name: "3F 복도 동쪽" },
        direction: "one-way",
        waypoints: [{ x: 52.00, y: 63.00 }],
      },
      {
        from: { x: 72.83, y: 65.65, name: "3F 복도 동쪽" },
        to: { x: 46.15, y: 33.09, name: "병동 휴게실" },
        direction: "one-way",
        waypoints: [{ x: 60.00, y: 48.00 }],
      },
    ],
  },
];
