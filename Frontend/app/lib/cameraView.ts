import type { Camera } from "@/app/type";

// 카메라 목록 반환 — URL은 클라이언트에서 동적으로 구성
export default async function getCameras(): Promise<Camera[]> {
  return [
    { id: 1, label: "CAM 1", webrtcUrl: "" },
    { id: 2, label: "CAM 2", webrtcUrl: "" },
    { id: 3, label: "CAM 3", webrtcUrl: "ws://192.168.0.154:8765" }
  ];
}
