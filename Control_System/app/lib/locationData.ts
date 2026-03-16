import type { LocationItem } from "@/app/type";

// const API_BASE = process.env.API_BASE; // 서버 컴포넌트용 환경변수

// 서버에서 카메라 목록 가져오고 → 가공해서 반환
export default async function getLocationStatus(): Promise<LocationItem[]> {

//   const res = await fetch(`${API_BASE}/floors`, {
//     cache: "no-store", // 항상 최신 데이터가 필요하면
//   });

//   if (!res.ok) {
//     throw new Error("Failed to fetch robots");
//   }

//   const raw = await res.json();
  const raw = [
    { id: 1, label: "Yes" },
    { id: 2, label: "No" }
  ];
  

  const location = raw.map((item: any) => ({
    id: item.id,
    label: item.label,
  }));

  return location;
}