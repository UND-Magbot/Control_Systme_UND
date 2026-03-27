import type { Camera } from "@/app/type";
import { API_BASE } from "@/app/config";

// 서버에서 카메라 목록 가져오고 → 가공해서 반환
export default async function getCameras(): Promise<Camera[]> {
  const raw = [
    { id: 1, label: "전방", type:"http", webrtcUrl: `${API_BASE}/Video/1` },
    { id: 2, label: "후방", type:"http", webrtcUrl: `${API_BASE}/Video/2` },
    { id: 4, label: "TEST-CAM3", type:"http", webrtcUrl: `${API_BASE}/Video/1` },
    { id: 5, label: "TEST-CAM4", type:"http", webrtcUrl: `${API_BASE}/Video/2` },
  ]

  const cameras: Camera[] = raw.map((item: any) => ({
    id: item.id,
    label: item.label,
    webrtcUrl: item.webrtcUrl,
  }));

  return cameras;
}
