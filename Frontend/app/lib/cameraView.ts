import type { Camera, RobotModule } from "@/app/types";
import { apiFetch } from "@/app/lib/api";
import { getWebrtcBase } from "@/app/config";

/**
 * 모듈 트리에서 type="camera"인 노드를 flat 배열로 추출
 */
function extractCameras(modules: RobotModule[]): Camera[] {
  const cameras: Camera[] = [];
  const webrtcBase = getWebrtcBase();

  function walk(nodes: RobotModule[]) {
    for (const node of nodes) {
      if (node.type === "camera" && node.isActive && node.config) {
        const cfg = node.config as {
          streamType: "rtsp" | "ws" | "http";
          streamUrl: string;
          path?: string | null;
        };

        let url: string;
        if (cfg.streamType === "rtsp") {
          // RTSP 카메라는 MediaMTX(WebRTC/WHEP)로 저지연 송출한다.
          // 규칙: MediaMTX 경로명 = 로봇 RTSP path의 basename (예: "/video1" → "video1").
          const mtxPath = (cfg.path ?? "").replace(/^\/+/, "").trim();
          url = mtxPath ? `${webrtcBase}/${mtxPath}/whep` : "";
        } else {
          // ws(열화상)/http(외부 MJPEG)는 외부 절대 URL을 그대로 사용
          url = cfg.streamUrl;
        }

        cameras.push({
          id: node.id,
          label: node.label,
          streamType: cfg.streamType,
          webrtcUrl: url,
        });
      }
      if (node.children?.length) walk(node.children);
    }
  }

  walk(modules);
  cameras.sort((a, b) => a.id - b.id);
  return cameras;
}

/**
 * 로봇 ID로 해당 로봇의 카메라 목록을 가져옴
 */
export async function getCamerasForRobot(robotId: number): Promise<Camera[]> {
  try {
    const res = await apiFetch(`/DB/robots/${robotId}/modules`);
    if (!res.ok) return [];
    const data = await res.json();
    return extractCameras(data.modules ?? []);
  } catch {
    return [];
  }
}
