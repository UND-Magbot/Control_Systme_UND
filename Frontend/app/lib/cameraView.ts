import type { Camera, RobotModule } from "@/app/types";
import { apiFetch } from "@/app/lib/api";
import { API_BASE } from "@/app/config";

/**
 * 모듈 트리에서 type="camera"인 노드를 flat 배열로 추출
 */
function extractCameras(modules: RobotModule[]): Camera[] {
  const cameras: Camera[] = [];

  function walk(nodes: RobotModule[]) {
    for (const node of nodes) {
      if (node.type === "camera" && node.isActive && node.config) {
        const cfg = node.config as {
          streamType: "rtsp" | "ws";
          streamUrl: string;
        };
        cameras.push({
          id: node.id,
          label: node.label,
          streamType: cfg.streamType,
          webrtcUrl:
            cfg.streamType === "ws"
              ? cfg.streamUrl
              : `${API_BASE}${cfg.streamUrl}`,
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
