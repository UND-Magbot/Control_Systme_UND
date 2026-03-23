import type { PowerItem } from "@/app/type";

// const API_BASE = process.env.API_BASE; // 서버 컴포넌트용 환경변수

// 서버에서 카메라 목록 가져오고 → 가공해서 반환
export default async function getPowerStatus(): Promise<PowerItem[]> {

//   const res = await fetch(`${API_BASE}/floors`, {
//     cache: "no-store", // 항상 최신 데이터가 필요하면
//   });

//   if (!res.ok) {
//     throw new Error("Failed to fetch robots");
//   }

//   const raw = await res.json();
  const raw = [
    { id: 1, label: "On" },
    { id: 2, label: "Off" }
  ];
  

  const power = raw.map((item: any) => ({
    id: item.id,
    label: item.label,
  }));

  return power;
}