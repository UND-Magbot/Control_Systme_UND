// /app/mock/place_data.ts
export type PlaceRow = {
  id: number;
  robotNo: string;   // "Robot 1"
  floor: string;     // "1F", "2F", "B1" ...
  placeName: string; // "장소명 345"
  x: number;
  y: number;
  direction: number; // 방향(yaw) 각도
  updatedAt: string; // "2025.12.12 오전 10:35:47"
};

