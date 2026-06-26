import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDangerZoneDraw } from "../useDangerZoneDraw";

describe("useDangerZoneDraw", () => {
  it("초기 상태는 idle", () => {
    const { result } = renderHook(() => useDangerZoneDraw());
    expect(result.current.status).toBe("idle");
    expect(result.current.isDrawing).toBe(false);
    expect(result.current.points).toHaveLength(0);
  });

  it("start → addPoint 로 꼭짓점이 쌓인다", () => {
    const { result } = renderHook(() => useDangerZoneDraw());
    act(() => result.current.start());
    act(() => result.current.addPoint({ x: 0, y: 0 }));
    act(() => result.current.addPoint({ x: 4, y: 0 }));
    act(() => result.current.addPoint({ x: 4, y: 4 }));
    expect(result.current.points).toHaveLength(3);
    expect(result.current.isDrawing).toBe(true);
    expect(result.current.canFinish).toBe(true);
  });

  it("2점이면 canFinish=false", () => {
    const { result } = renderHook(() => useDangerZoneDraw());
    act(() => result.current.start());
    act(() => result.current.addPoint({ x: 0, y: 0 }));
    act(() => result.current.addPoint({ x: 4, y: 0 }));
    expect(result.current.canFinish).toBe(false);
  });

  it("undo는 마지막 점 제거", () => {
    const { result } = renderHook(() => useDangerZoneDraw());
    act(() => result.current.start());
    act(() => result.current.addPoint({ x: 0, y: 0 }));
    act(() => result.current.addPoint({ x: 4, y: 0 }));
    act(() => result.current.undo());
    expect(result.current.points).toHaveLength(1);
  });

  it("finish는 닫기 성공 시 점 배열 반환 후 closed", () => {
    const { result } = renderHook(() => useDangerZoneDraw());
    act(() => result.current.start());
    act(() => result.current.addPoint({ x: 0, y: 0 }));
    act(() => result.current.addPoint({ x: 4, y: 0 }));
    act(() => result.current.addPoint({ x: 4, y: 4 }));

    let finished: ReturnType<typeof result.current.finish> = null;
    act(() => {
      finished = result.current.finish();
    });
    expect(finished).not.toBeNull();
    expect(finished).toHaveLength(3);
    expect(result.current.status).toBe("closed");
  });

  it("finish는 2점이면 null 반환, 상태 유지", () => {
    const { result } = renderHook(() => useDangerZoneDraw());
    act(() => result.current.start());
    act(() => result.current.addPoint({ x: 0, y: 0 }));
    act(() => result.current.addPoint({ x: 4, y: 0 }));

    let finished: ReturnType<typeof result.current.finish> = null;
    act(() => {
      finished = result.current.finish();
    });
    expect(finished).toBeNull();
    expect(result.current.status).toBe("drawing");
  });

  it("reset은 idle 초기화", () => {
    const { result } = renderHook(() => useDangerZoneDraw());
    act(() => result.current.start());
    act(() => result.current.addPoint({ x: 0, y: 0 }));
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
    expect(result.current.points).toHaveLength(0);
  });
});
