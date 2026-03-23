export type PathRow = {
  id: number;
  robotNo: string;
  workType: string;
  pathName: string;
  pathOrder: string; // "A - B - ... - A" (첫=끝)
  updatedAt: string;
};

export const mockPathRows: PathRow[] = [
  // ===================== Robot 1 (4개) =====================
  {
    id: 1,
    robotNo: "Robot 1",
    workType: "task1",
    pathName: "Robot 1 경로 1",
    pathOrder: "장소명 345 - 중앙 복도 - 장소명 1112 - 장소명 0123 - 장소명 345",
    updatedAt: "2025.12.20 10:00:00",
  },
  {
    id: 2,
    robotNo: "Robot 1",
    workType: "task3",
    pathName: "Robot 1 경로 2",
    pathOrder: "수술실 대기 - 검사실 A - 장소명 0123 - 장소명 1112 - 중앙 복도 - 수술실 대기",
    updatedAt: "2025.12.20 11:10:00",
  },
  {
    id: 3,
    robotNo: "Robot 1",
    workType: "task2",
    pathName: "Robot 1 경로 3",
    pathOrder: "간호사실 - 중앙 복도 - 장소명 10123 - 장소명 0123 - 간호사실",
    updatedAt: "2025.12.20 12:20:00",
  },
  {
    id: 4,
    robotNo: "Robot 1",
    workType: "task1",
    pathName: "Robot 1 경로 4",
    pathOrder: "검사실 A - 장소명 1112 - 장소명 345 - 수술실 대기 - 장소명 10123 - 검사실 A",
    updatedAt: "2025.12.20 13:30:00",
  },

  // ===================== Robot 2 (4개) =====================
  {
    id: 5,
    robotNo: "Robot 2",
    workType: "task3",
    pathName: "Robot 2 경로 1",
    pathOrder: "약국 앞 - 간호 스테이션 - 장소명 22 - 물품 보관실 - 수술실 복도 - 약국 앞",
    updatedAt: "2025.12.20 14:40:00",
  },
  {
    id: 6,
    robotNo: "Robot 2",
    workType: "task1",
    pathName: "Robot 2 경로 2",
    pathOrder: "엘리베이터 홀 - 장소명 234 - 검체 운반함 - 간호 스테이션 - 약국 앞 - 엘리베이터 홀",
    updatedAt: "2025.12.20 15:50:00",
  },
  {
    id: 7,
    robotNo: "Robot 2",
    workType: "task2",
    pathName: "Robot 2 경로 3",
    pathOrder: "간호 스테이션 - 장소명 234 - 물품 보관실 - 장소명 22 - 간호 스테이션",
    updatedAt: "2025.12.20 17:00:00",
  },
  {
    id: 8,
    robotNo: "Robot 2",
    workType: "task3",
    pathName: "Robot 2 경로 4",
    pathOrder: "검체 운반함 - 수술실 복도 - 장소명 234 - 약국 앞 - 엘리베이터 홀 - 검체 운반함",
    updatedAt: "2025.12.20 18:10:00",
  },

  // ===================== Robot 3 (3개) =====================
  {
    id: 9,
    robotNo: "Robot 3",
    workType: "task1",
    pathName: "Robot 3 경로 1",
    pathOrder: "회의실 - 기계실 입구 - 충전 스테이션 - 장소명 1359 - 검사실 A - 회의실",
    updatedAt: "2025.12.20 19:20:00",
  },
  {
    id: 10,
    robotNo: "Robot 3",
    workType: "task2",
    pathName: "Robot 3 경로 2",
    pathOrder: "장소명 12345 - 엘리베이터 홀 - 기계실 입구 - 장소명 1359 - 장소명 12345",
    updatedAt: "2025.12.20 20:30:00",
  },
  {
    id: 11,
    robotNo: "Robot 3",
    workType: "task3",
    pathName: "Robot 3 경로 3",
    pathOrder: "충전 스테이션 - 검사실 A - 장소명 12345 - 엘리베이터 홀 - 회의실 - 충전 스테이션",
    updatedAt: "2025.12.20 21:40:00",
  },

  // ===================== Robot 4 (3개) =====================
  {
    id: 12,
    robotNo: "Robot 4",
    workType: "task3",
    pathName: "Robot 4 경로 1",
    pathOrder: "로비 - 접수처 - 수납창구 - 약국 - 검사실 B - 로비",
    updatedAt: "2025.12.20 22:50:00",
  },
  {
    id: 13,
    robotNo: "Robot 4",
    workType: "task2",
    pathName: "Robot 4 경로 2",
    pathOrder: "응급실 입구 - 주차장 입구 - 로비 - 검사실 A - 접수처 - 응급실 입구",
    updatedAt: "2025.12.21 00:00:00",
  },
  {
    id: 14,
    robotNo: "Robot 4",
    workType: "task1",
    pathName: "Robot 4 경로 3",
    pathOrder: "검사실 A - 검사실 B - 약국 - 수납창구 - 로비 - 검사실 A",
    updatedAt: "2025.12.21 01:10:00",
  },

  // ===================== Robot 5 (3개) =====================
  {
    id: 15,
    robotNo: "Robot 5",
    workType: "task3",
    pathName: "Robot 5 경로 1",
    pathOrder: "창고 - 배송대기 - 약품보관실 - 수액 준비실 - 간호 스테이션 - 창고",
    updatedAt: "2025.12.21 02:20:00",
  },
  {
    id: 16,
    robotNo: "Robot 5",
    workType: "task1",
    pathName: "Robot 5 경로 2",
    pathOrder: "진료실 A - 폐기물실 - 세척실 - 창고 - 약품보관실 - 진료실 A",
    updatedAt: "2025.12.21 03:30:00",
  },
  {
    id: 17,
    robotNo: "Robot 5",
    workType: "task2",
    pathName: "Robot 5 경로 3",
    pathOrder: "간호 스테이션 - 수액 준비실 - 배송대기 - 폐기물실 - 간호 스테이션",
    updatedAt: "2025.12.21 04:40:00",
  },

  // ===================== Robot 6 (3개) =====================
  {
    id: 18,
    robotNo: "Robot 6",
    workType: "task2",
    pathName: "Robot 6 경로 1",
    pathOrder: "병동 휴게실 - 3F 복도 서쪽 - 엘리베이터 앞 - 3F 복도 동쪽 - 병동 휴게실",
    updatedAt: "2025.12.21 05:50:00",
  },
  {
    id: 19,
    robotNo: "Robot 6",
    workType: "task1",
    pathName: "Robot 6 경로 2",
    pathOrder: "격리병실 앞 - 충전 스테이션 - 세척실 - 약국 앞 - 엘리베이터 앞 - 격리병실 앞",
    updatedAt: "2025.12.21 07:00:00",
  },
  {
    id: 20,
    robotNo: "Robot 6",
    workType: "task3",
    pathName: "Robot 6 경로 3",
    pathOrder: "장소명 65432 - 3F 복도 동쪽 - 엘리베이터 앞 - 약국 앞 - 충전 스테이션 - 장소명 65432",
    updatedAt: "2025.12.21 08:10:00",
  },
];
