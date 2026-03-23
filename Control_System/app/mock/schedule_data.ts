// /app/mock/schedule_data.ts
import type { PlaceRow } from "./robotPlace_data";
import type { PathRow } from "./robotPath_data";

export type ScheduleStatus = "완료" | "진행" | "대기" | "오류";

export type ScheduleRow = {
  id: string;

  title: string;      // 표시용
  robotNo: string;
  workType: string;

  date: string;       // "YYYY-MM-DD"
  startMin: number;   // 0~1439
  endMin: number;     // 1~1440

  status: ScheduleStatus;
  color?: "green" | "yellow" | "blue" | "red";

  // 참조
  placeId?: PlaceRow["id"] | null;
  pathId?: PathRow["id"] | null;

  memo?: string;
};

export const mockScheduleRows: ScheduleRow[] = [
  // 01/09 (같은 날 여러 개 -> 월간 팝업 테스트에 유리)
  {
    id: "s1",
    title: "[완] Robot 3, 1F 순찰 및 보안 실시",
    robotNo: "Robot 3",
    workType: "task2",
    date: "2026-01-09",
    startMin: 510,
    endMin: 540,
    status: "완료",
    color: "green",
    placeId: 1,   // 로비
    pathId: 1,    // 1F 순찰 루트 A (Robot 3 / 순찰)
  },
  {
    id: "s2",
    title: "[진] Robot 4, 3F 병동 라운드 모니터링",
    robotNo: "Robot 4",
    workType: "task1",
    date: "2026-01-09",
    startMin: 600,
    endMin: 630,
    status: "진행",
    color: "red",
    placeId: 4,   // 간호스테이션
    pathId: 2,    // 3F 병동 라운드 (Robot 4 / 모니터링)
  },
  {
    id: "s3",
    title: "[대] Robot 2, 2F 검사실 물품 운반",
    robotNo: "Robot 2",
    workType: "task3",
    date: "2026-01-09",
    startMin: 680,
    endMin: 715,
    status: "대기",
    color: "blue",
    placeId: 8,  // 검사실
    pathId: 3,   // 2F 검사실 운반 (Robot 2 / 운반)
  },
  {
    id: "s4",
    title: "[완] Robot 7, 1F 야간 순찰 사전 점검",
    robotNo: "Robot 7",
    workType: "task2",
    date: "2026-01-09",
    startMin: 780,
    endMin: 805,
    status: "완료",
    color: "green",
    placeId: 1,  // 로비
    pathId: 5,   // 1F 야간 순찰 (Robot 7 / 순찰)
  },
  {
    id: "s5",
    title: "[진] Robot 5, 3F 약품 회수 운반 작업",
    robotNo: "Robot 5",
    workType: "task3",
    date: "2026-01-09",
    startMin: 850,
    endMin: 885,
    status: "진행",
    color: "yellow",
    placeId: 4,  // 간호스테이션
    pathId: 4,   // 3F 약품 회수 (Robot 5 / 운반)
  },

  // 01/01
  {
    id: "s6",
    title: "[완] Robot 3, 1F 순찰 루트 A 추가 순찰",
    robotNo: "Robot 3",
    workType: "task2",
    date: "2026-01-01",
    startMin: 510,
    endMin: 540,
    status: "완료",
    color: "green",
    placeId: 2, // 접수처
    pathId: 1,
  },
  {
    id: "s7",
    title: "[대] Robot 2, 2F 물품보관실 → 검사실 운반",
    robotNo: "Robot 2",
    workType: "task3",
    date: "2026-01-01",
    startMin: 580,
    endMin: 610,
    status: "대기",
    color: "blue",
    placeId: 9, // 물품보관실
    pathId: 3,
  },

  // 01/13
  {
    id: "s8",
    title: "[진] Robot 4, 3F 병실 301 모니터링",
    robotNo: "Robot 4",
    workType: "task1",
    date: "2026-01-13",
    startMin: 900,
    endMin: 935,
    status: "진행",
    color: "red",
    placeId: 5, // 병실 301
    pathId: 2,
  },

  // 01/15
  {
    id: "s9",
    title: "[완] Robot 7, 1F 야간 순찰 리허설",
    robotNo: "Robot 7",
    workType: "task2",
    date: "2026-01-15",
    startMin: 970,
    endMin: 1000,
    status: "완료",
    color: "green",
    placeId: 1,
    pathId: 5,
  },

  // 01/18
  {
    id: "s10",
    title: "[대] Robot 5, 3F 약품 회수 운반(2회차)",
    robotNo: "Robot 5",
    workType: "task3",
    date: "2026-01-18",
    startMin: 660,
    endMin: 685,
    status: "대기",
    color: "yellow",
    placeId: 4,
    pathId: 4,
  },
];
