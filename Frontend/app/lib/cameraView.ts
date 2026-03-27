import type { Camera } from "@/app/type";
import { getApiBase } from "@/app/config";

// 서버에서 카메라 목록 가져오고 → 가공해서 반환
export default async function getCameras(): Promise<Camera[]> {
  const base = getApiBase();
  const raw = [
    { id: 1, label: "CAM 1", type:"http", webrtcUrl: `${base}/Video/1` },
    { id: 2, label: "CAM 2", type:"http", webrtcUrl: `${base}/Video/2` },
    { id: 3, label: "CAM 3", type:"ws", webrtcUrl: "ws://192.168.0.154:8765" }
  ]

  const cameras: Camera[] = raw.map((item: any) => ({
    id: item.id,
    label: item.label,
    webrtcUrl: item.webrtcUrl,
  }));

  return cameras;
}
