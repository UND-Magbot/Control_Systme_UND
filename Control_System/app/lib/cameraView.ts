import type { Camera } from "@/app/type";

// 카메라 목록 (webrtcUrl은 클라이언트에서 API_BASE로 조합)
export default async function getCameras(): Promise<Camera[]> {
  const raw = [
    { id: 1, label: "CAM 1", type:"http", webrtcUrl: "/Video/1" },
    { id: 2, label: "CAM 2", type:"http", webrtcUrl: "/Video/2" },
    { id: 3, label: "CAM 3", type:"ws", webrtcUrl: "ws://192.168.0.154:8765" }
  ]

  const cameras: Camera[] = raw.map((item: any) => ({
    id: item.id,
    label: item.label,
    webrtcUrl: item.webrtcUrl,
  }));

  return cameras;
}
