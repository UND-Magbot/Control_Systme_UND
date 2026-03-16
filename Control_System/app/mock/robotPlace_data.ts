// /app/mock/place_data.ts
export type PlaceRow = {
  id: number;
  robotNo: string;   // "Robot 1"
  floor: string;     // "1F", "2F", "B1" ...
  placeName: string; // "장소명 345"
  x: number;
  y: number;
  updatedAt: string; // "2025.12.12 오전 10:35:47"
};

export const mockPlaceRows: PlaceRow[] = [
  { id: 1,  robotNo: "Robot 2", floor: "3F", placeName: "장소명 234",   x: 26.21, y: 50.37, updatedAt: "2025.12.12 오전 10:35:47" },
  { id: 2,  robotNo: "Robot 3", floor: "2F", placeName: "장소명 12345", x: 51.35, y: 48.22, updatedAt: "2025.12.12 오전 11:12:03" },
  { id: 3,  robotNo: "Robot 1", floor: "1F", placeName: "장소명 345",   x: 66.08, y: 30.12, updatedAt: "2025.12.12 오후 01:05:19" },
  { id: 4,  robotNo: "Robot 1", floor: "1F", placeName: "장소명 0123",  x: 50.34, y: 55.46, updatedAt: "2025.12.12 오후 02:44:51" },
  { id: 5,  robotNo: "Robot 6", floor: "3F", placeName: "장소명 65432", x: 63.28, y: 58.25, updatedAt: "2025.12.12 오후 03:18:09" },
  { id: 6,  robotNo: "Robot 5", floor: "1F", placeName: "진료실 A",     x: 42.51, y: 60.13, updatedAt: "2025.12.12 오후 03:44:22" },
  { id: 7,  robotNo: "Robot 4", floor: "1F", placeName: "접수처",       x: 38.72, y: 41.08, updatedAt: "2025.12.12 오후 04:22:06" },
  { id: 8,  robotNo: "Robot 3", floor: "2F", placeName: "장소명 1359",  x: 57.09, y: 44.39, updatedAt: "2025.12.12 오후 05:11:35" },
  { id: 9,  robotNo: "Robot 2", floor: "3F", placeName: "장소명 22",    x: 35.12, y: 64.77, updatedAt: "2025.12.12 오후 06:07:12" },
  { id: 10, robotNo: "Robot 6", floor: "3F", placeName: "병동 휴게실",  x: 46.15, y: 33.09, updatedAt: "2025.12.13 오전 09:22:44" },
  { id: 11, robotNo: "Robot 1", floor: "2F", placeName: "장소명 1112",  x: 71.21, y: 29.81, updatedAt: "2025.12.13 오전 10:01:27" },
  { id: 12, robotNo: "Robot 1", floor: "2F", placeName: "장소명 10123", x: 44.12, y: 26.55, updatedAt: "2025.12.13 오전 10:47:03" },
  { id: 13, robotNo: "Robot 2", floor: "3F", placeName: "장소명 234",   x: 60.88, y: 45.91, updatedAt: "2025.12.13 오전 11:25:42" },
  { id: 14, robotNo: "Robot 5", floor: "1F", placeName: "창고",         x: 52.03, y: 37.66, updatedAt: "2025.12.13 오후 12:09:55" },
  { id: 15, robotNo: "Robot 4", floor: "1F", placeName: "검사실 B",     x: 49.55, y: 58.33, updatedAt: "2025.12.14 오전 09:05:14" },
  { id: 16, robotNo: "Robot 3", floor: "2F", placeName: "기계실 입구",  x: 28.40, y: 40.20, updatedAt: "2025.12.14 오전 10:18:29" },
  { id: 17, robotNo: "Robot 2", floor: "3F", placeName: "약국 앞",      x: 41.77, y: 62.11, updatedAt: "2025.12.14 오전 11:36:02" },
  { id: 18, robotNo: "Robot 1", floor: "2F", placeName: "수술실 대기",  x: 62.05, y: 44.18, updatedAt: "2025.12.14 오후 01:11:45" },
  { id: 19, robotNo: "Robot 3", floor: "4F", placeName: "회의실",       x: 48.39, y: 35.92, updatedAt: "2025.12.14 오후 02:54:30" },
  { id: 20, robotNo: "Robot 2", floor: "3F", placeName: "간호 스테이션",x: 59.14, y: 52.77, updatedAt: "2025.12.14 오후 04:09:18" },
  { id: 21, robotNo: "Robot 1", floor: "1F", placeName: "중앙 복도",     x: 58.37, y: 21.50, updatedAt: "2025.12.15 오전 11:27:00" },
  { id: 22, robotNo: "Robot 1", floor: "1F", placeName: "간호사실",      x: 36.50, y: 33.39, updatedAt: "2025.12.15 오전 11:34:00" },
  { id: 23, robotNo: "Robot 1", floor: "2F", placeName: "검사실 A",      x: 64.19, y: 60.60, updatedAt: "2025.12.15 오전 11:41:00" },
  { id: 24, robotNo: "Robot 2", floor: "3F", placeName: "수술실 복도",    x: 73.53, y: 25.22, updatedAt: "2025.12.15 오전 11:48:00" },
  { id: 25, robotNo: "Robot 2", floor: "3F", placeName: "검체 운반함",    x: 45.32, y: 21.79, updatedAt: "2025.12.15 오전 11:55:00" },
  { id: 26, robotNo: "Robot 2", floor: "3F", placeName: "물품 보관실",    x: 33.12, y: 50.32, updatedAt: "2025.12.15 오후 12:02:00" },
  { id: 27, robotNo: "Robot 2", floor: "3F", placeName: "엘리베이터 홀",  x: 21.59, y: 31.93, updatedAt: "2025.12.15 오후 12:09:00" },
  { id: 28, robotNo: "Robot 3", floor: "2F", placeName: "검사실 A",      x: 58.99, y: 52.70, updatedAt: "2025.12.15 오후 12:16:00" },
  { id: 29, robotNo: "Robot 3", floor: "2F", placeName: "엘리베이터 홀",  x: 33.23, y: 53.57, updatedAt: "2025.12.15 오후 12:23:00" },
  { id: 30, robotNo: "Robot 3", floor: "2F", placeName: "충전 스테이션",  x: 68.57, y: 20.39, updatedAt: "2025.12.15 오후 12:30:00" },
  { id: 31, robotNo: "Robot 4", floor: "1F", placeName: "로비",          x: 68.35, y: 61.89, updatedAt: "2025.12.15 오후 12:37:00" },
  { id: 32, robotNo: "Robot 4", floor: "1F", placeName: "수납창구",       x: 40.42, y: 29.33, updatedAt: "2025.12.15 오후 12:44:00" },
  { id: 33, robotNo: "Robot 4", floor: "1F", placeName: "약국",          x: 77.43, y: 40.22, updatedAt: "2025.12.15 오후 12:51:00" },
  { id: 34, robotNo: "Robot 4", floor: "1F", placeName: "응급실 입구",    x: 25.56, y: 25.80, updatedAt: "2025.12.15 오후 12:58:00" },
  { id: 35, robotNo: "Robot 4", floor: "B1", placeName: "주차장 입구",    x: 70.85, y: 56.25, updatedAt: "2025.12.15 오후 01:05:00" },
  { id: 36, robotNo: "Robot 4", floor: "1F", placeName: "검사실 A",      x: 68.43, y: 64.89, updatedAt: "2025.12.15 오후 01:12:00" },
  { id: 37, robotNo: "Robot 5", floor: "3F", placeName: "약품보관실",     x: 52.28, y: 78.43, updatedAt: "2025.12.15 오후 01:19:00" },
  { id: 38, robotNo: "Robot 5", floor: "3F", placeName: "수액 준비실",    x: 42.70, y: 53.17, updatedAt: "2025.12.15 오후 01:26:00" },
  { id: 39, robotNo: "Robot 5", floor: "3F", placeName: "배송대기",       x: 70.57, y: 73.70, updatedAt: "2025.12.15 오후 01:33:00" },
  { id: 40, robotNo: "Robot 5", floor: "3F", placeName: "폐기물실",       x: 46.27, y: 73.83, updatedAt: "2025.12.15 오후 01:40:00" },
  { id: 41, robotNo: "Robot 5", floor: "3F", placeName: "세척실",         x: 22.75, y: 34.13, updatedAt: "2025.12.15 오후 01:47:00" },
  { id: 42, robotNo: "Robot 5", floor: "3F", placeName: "간호 스테이션",  x: 35.60, y: 26.00, updatedAt: "2025.12.15 오후 01:54:00" },
  { id: 43, robotNo: "Robot 6", floor: "3F", placeName: "3F 복도 서쪽",   x: 73.42, y: 56.12, updatedAt: "2025.12.15 오후 02:01:00" },
  { id: 44, robotNo: "Robot 6", floor: "3F", placeName: "3F 복도 동쪽",   x: 72.83, y: 65.65, updatedAt: "2025.12.15 오후 02:08:00" },
  { id: 45, robotNo: "Robot 6", floor: "4F", placeName: "격리병실 앞",    x: 70.99, y: 47.80, updatedAt: "2025.12.15 오후 02:15:00" },
  { id: 46, robotNo: "Robot 6", floor: "3F", placeName: "엘리베이터 앞",  x: 32.83, y: 59.49, updatedAt: "2025.12.15 오후 02:22:00" },
  { id: 47, robotNo: "Robot 6", floor: "3F", placeName: "세척실",         x: 36.02, y: 76.20, updatedAt: "2025.12.15 오후 02:29:00" },
  { id: 48, robotNo: "Robot 6", floor: "3F", placeName: "충전 스테이션",  x: 58.88, y: 56.55, updatedAt: "2025.12.15 오후 02:36:00" },
  { id: 49, robotNo: "Robot 6", floor: "3F", placeName: "약국 앞",        x: 30.27, y: 63.75, updatedAt: "2025.12.15 오후 02:43:00" },
];