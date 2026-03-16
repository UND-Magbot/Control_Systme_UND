import type { Camera } from "@/app/type";

const API_BASE = process.env.API_BASE; // 서버 컴포넌트용 환경변수

// 서버에서 카메라 목록 가져오고 → 가공해서 반환
export default async function getCameras(): Promise<Camera[]> {
  // const res = await fetch(`${API_BASE}/cameras`, {
  //   cache: "no-store",
  // });

  // if (!res.ok) {
  //   throw new Error("Failed to fetch cameras");
  // }

  // const raw = await res.json();
  
  const raw = [
    { id: 1, label: "CAM 1", type:"http", webrtcUrl: "http://localhost:8000/Video/1" },
    { id: 2, label: "CAM 2", type:"http", webrtcUrl: "http://localhost:8000/Video/2" },
    { id: 3, label: "CAM 3", type:"ws", webrtcUrl: "ws://192.168.0.154:8765" }
    // ,
    // { id: 4, label: "CAM 3", type:"ws", webrtcUrl: "ws://192.168.0.154:8765" },
    // { id: 5, label: "CAM 3", type:"ws", webrtcUrl: "ws://192.168.0.154:8765" }
  ]

  const cameras: Camera[] = raw.map((item: any) => ({
    id: item.id,
    label: item.label,
    webrtcUrl: item.webrtcUrl,
  }));

  return cameras;
}
