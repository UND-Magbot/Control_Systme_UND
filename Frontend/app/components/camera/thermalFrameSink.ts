// 열화상 프레임 싱크 — WS로 들어오는 Blob 프레임을 합쳐(coalesce) "최신 1장"만,
// 그리고 최대 ~15fps로만 렌더한다.
//
// 왜: 서버가 프레임을 빠르게 보내거나 브라우저 디코딩/페인트가 못 따라가면, 매 프레임
// objectURL 생성 + setState + 디코딩 + 페인트가 쌓여 CPU를 낭비하고 "빨리감기"를 만든다.
// 대기 중 프레임은 최신 1장만 남기고 버리며, requestAnimationFrame 기반이라 탭이
// 백그라운드면 자동으로 렌더가 멈춘다(Page Visibility 효과).
//
// objectURL 수명도 싱크가 직접 관리한다(생성 → 다음 프레임에서 이전 것 revoke).

const THERMAL_RENDER_MIN_INTERVAL_MS = 66; // 약 15fps 상한 (발열 스크리닝엔 충분)

export type ThermalFrameSink = {
  /** 새 Blob 프레임 도착 — 최신만 보관하고 렌더를 스케줄한다(이전 대기 프레임은 버림). */
  push: (blob: Blob) => void;
  /** 대기 프레임·objectURL을 정리하고 표시를 비운다(언마운트/모달 닫힘/소스 전환 시). */
  reset: () => void;
};

export function createThermalFrameSink(
  setUrl: (url: string | null) => void,
): ThermalFrameSink {
  let pending: Blob | null = null;
  let rafId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let prevUrl: string | null = null;
  let lastRenderAt = 0;

  const render = () => {
    rafId = null;
    timer = null;
    const blob = pending;
    pending = null;
    if (!blob) return;
    lastRenderAt = performance.now();
    const url = URL.createObjectURL(blob);
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    prevUrl = url;
    setUrl(url);
  };

  const schedule = () => {
    if (rafId !== null || timer !== null) return;
    const wait = THERMAL_RENDER_MIN_INTERVAL_MS - (performance.now() - lastRenderAt);
    if (wait > 0) {
      timer = setTimeout(() => {
        timer = null;
        rafId = requestAnimationFrame(render);
      }, wait);
    } else {
      rafId = requestAnimationFrame(render);
    }
  };

  return {
    push(blob) {
      pending = blob; // 최신만 유지 — 못 그린 이전 프레임은 폐기(backlog 방지)
      schedule();
    },
    reset() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (timer !== null) { clearTimeout(timer); timer = null; }
      pending = null;
      if (prevUrl) { URL.revokeObjectURL(prevUrl); prevUrl = null; }
      setUrl(null);
    },
  };
}
