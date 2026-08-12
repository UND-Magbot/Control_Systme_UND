/**
 * RM 6축 팔 제어 API 클라이언트 (Phase 1 · additive).
 *
 * 백엔드 `robot_control/arm/routes.py` 의 `/robot/arm/*` 를 소비한다.
 * 관측(status/presets)은 권한만, 제어(pause/preset 등)는 제어권 헤더(X-Control-Token)를 실어 보낸다.
 */
import { apiFetch } from "@/app/lib/api";

export type ArmStatus =
  | { connected: false }
  | {
      connected: true;
      joints_deg?: number[];
      pose?: number[];
      arm_err?: number | string;
      sys_err?: number | string;
      joint_temperatures?: number[];
      error?: string;
    };

export type ArmPreset = {
  key: string;
  label: string;
  verified: boolean;
  note: string;
};

type Headers = Record<string, string>;

/** 연결·관절각·자세·온도. 미연결이면 { connected:false }. */
export async function getArmStatus(): Promise<ArmStatus> {
  const res = await apiFetch("/robot/arm/status");
  if (!res.ok) throw new Error(`arm status ${res.status}`);
  return res.json();
}

/** 프리셋 목록(+검증 여부). 미검증(verified:false)은 이동 불가. */
export async function getArmPresets(): Promise<ArmPreset[]> {
  const res = await apiFetch("/robot/arm/presets");
  if (!res.ok) throw new Error(`arm presets ${res.status}`);
  const body = await res.json();
  return body.presets ?? [];
}

async function post(path: string, headers: Headers = {}): Promise<Response> {
  return apiFetch(path, { method: "POST", headers });
}

/** 일시정지 — 궤적 정지, 재개 가능(Move_Pause). 안전 예외라 권한만. */
export const armPause = (h?: Headers) => post("/robot/arm/pause", h);
/** 일시정지 재개. 제어권 필요. */
export const armResume = (h: Headers) => post("/robot/arm/resume", h);
/** 궤적 정지(Move_Stop). */
export const armStop = (h?: Headers) => post("/robot/arm/stop", h);
/** 긴급정지 — 전원 차단(처짐). 안전 예외라 권한만. */
export const armEstop = (h?: Headers) => post("/robot/arm/estop", h);
/** 에러 초기화. 제어권 필요. */
export const armClearErrors = (h: Headers) => post("/robot/arm/clear-errors", h);
/** 프리셋 이동. 제어권 필요. 미검증 프리셋은 409. */
export const armMovePreset = (key: string, h: Headers) =>
  post(`/robot/arm/preset/${encodeURIComponent(key)}`, h);
