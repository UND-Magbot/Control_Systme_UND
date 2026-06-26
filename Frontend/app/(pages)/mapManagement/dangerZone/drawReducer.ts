// 위험구역 그리기 상태머신 (순수 reducer)
// 맵 클릭으로 꼭짓점을 추가하고, 3점 이상이면 닫아서 폴리곤을 완성한다.
// React 의존성 없이 순수 함수라 단위테스트로 검증 가능하다.

import type { ZonePoint } from "./types";
import { canClosePolygon } from "./validation";
import { segmentsIntersect } from "./geometry";

export type DrawStatus = "idle" | "drawing" | "closed";

export type DrawState = {
  status: DrawStatus;
  points: ZonePoint[];
};

export type DrawAction =
  | { type: "START" }
  | { type: "ADD_POINT"; point: ZonePoint; minGap?: number }
  | { type: "UNDO" }
  | { type: "CLOSE"; minArea?: number }
  | { type: "RESET" };

export const initialDrawState: DrawState = {
  status: "idle",
  points: [],
};

/** 기본 점 간 최소 간격(m) — 더블클릭/손떨림 중복점 방지 */
const DEFAULT_MIN_GAP = 0.05;

function tooClose(a: ZonePoint, b: ZonePoint, minGap: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) < minGap;
}

/**
 * 새 점을 추가하면 "닫는 변"을 제외한 기존 변과 교차하는지 검사.
 * (마지막 변 a(n-2)->b(n-1) 와 새 변 b(n-1)->p 는 끝점 공유라 제외)
 */
function wouldSelfIntersect(points: ZonePoint[], p: ZonePoint): boolean {
  const n = points.length;
  if (n < 2) return false;
  const last = points[n - 1];
  // 새 변: last -> p / 기존 변들과 비교 (인접 변 제외)
  for (let i = 0; i < n - 2; i++) {
    if (segmentsIntersect(points[i], points[i + 1], last, p)) return true;
  }
  return false;
}

export function drawReducer(state: DrawState, action: DrawAction): DrawState {
  switch (action.type) {
    case "START":
      return { status: "drawing", points: [] };

    case "ADD_POINT": {
      if (state.status !== "drawing") return state;
      const minGap = action.minGap ?? DEFAULT_MIN_GAP;
      const last = state.points[state.points.length - 1];
      if (last && tooClose(last, action.point, minGap)) return state;
      // 자기교차를 만드는 점은 거부
      if (wouldSelfIntersect(state.points, action.point)) return state;
      return { ...state, points: [...state.points, action.point] };
    }

    case "UNDO": {
      if (state.status !== "drawing" || state.points.length === 0) return state;
      return { ...state, points: state.points.slice(0, -1) };
    }

    case "CLOSE": {
      if (state.status !== "drawing") return state;
      if (!canClosePolygon(state.points, action.minArea ?? 0.01)) return state;
      return { ...state, status: "closed" };
    }

    case "RESET":
      return initialDrawState;

    default:
      return state;
  }
}

/** 현재 상태에서 닫기 가능 여부 (버튼 활성화 등 UI 판정용) */
export function canFinish(state: DrawState, minArea = 0.01): boolean {
  return state.status === "drawing" && canClosePolygon(state.points, minArea);
}
