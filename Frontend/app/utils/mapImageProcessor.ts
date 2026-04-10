/**
 * 점유 격자(Occupancy Grid) 이미지 처리 파이프라인
 * 2D Canvas 맵과 3D 맵 모두에서 공유
 */

/* ── 이미지 가공 캐시 ── */
const processedCache = new Map<string, HTMLCanvasElement>();

/* ── 분류맵 캐시 (3D 벽 생성용) ── */
const classMapCache = new Map<string, { data: Uint8Array; width: number; height: number }>();

// 색상 팔레트 (다크 테마 조화 + 가독성)
const WALL_COLOR = [130, 190, 255];    // 밝은 하늘색 벽
const FREE_COLOR = [90, 105, 140];     // 바닥 — 배경과 뚜렷한 대비
const UNKNOWN_COLOR = [26, 29, 46];    // #1a1d2e — wrapper 배경과 동일

// OccupancyGrid 임계값
const WALL_THRESH = 89;
const FREE_THRESH = 205;

/**
 * 분류맵 생성 (0=unknown, 1=wall, 2=free)
 * 노이즈 제거 + 벽 팽창 포함
 */
function buildClassificationMap(img: HTMLImageElement, src: string): { data: Uint8Array; width: number; height: number } {
  const cached = classMapCache.get(src);
  if (cached) return cached;

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = W;
  rawCanvas.height = H;
  const rawCtx = rawCanvas.getContext("2d")!;
  rawCtx.drawImage(img, 0, 0);
  const srcData = rawCtx.getImageData(0, 0, W, H);
  const src8 = srcData.data;

  // 1단계: 분류 맵
  const classMap = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const gray = src8[i * 4];
    if (gray <= WALL_THRESH) classMap[i] = 1;
    else if (gray >= FREE_THRESH) classMap[i] = 2;
    else classMap[i] = 0;
  }

  // 2단계: 노이즈 제거
  const cleaned = new Uint8Array(classMap);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      const cls = classMap[idx];
      if (cls === 0) continue;
      let sameCount = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (classMap[(y + dy) * W + (x + dx)] === cls) sameCount++;
        }
      }
      if (sameCount <= 2) {
        const counts = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            counts[classMap[(y + dy) * W + (x + dx)]]++;
          }
        }
        cleaned[idx] = counts[0] >= counts[1] && counts[0] >= counts[2] ? 0
                      : counts[1] >= counts[2] ? 1 : 2;
      }
    }
  }

  // 3단계: 벽 팽창(dilate) 2회
  let prev = cleaned;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(prev);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (prev[y * W + x] === 1) continue;
        if (
          prev[(y - 1) * W + x] === 1 ||
          prev[(y + 1) * W + x] === 1 ||
          prev[y * W + (x - 1)] === 1 ||
          prev[y * W + (x + 1)] === 1
        ) {
          next[y * W + x] = 1;
        }
      }
    }
    prev = next;
  }

  const result = { data: prev, width: W, height: H };
  classMapCache.set(src, result);
  return result;
}

/**
 * 가공된 맵 이미지 생성 (색상 매핑 + 안티앨리어싱)
 */
export function processMapImage(img: HTMLImageElement, src: string): HTMLCanvasElement {
  const cached = processedCache.get(src);
  if (cached) return cached;

  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const { data: dilated } = buildClassificationMap(img, src);

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = W;
  rawCanvas.height = H;
  const rawCtx = rawCanvas.getContext("2d")!;

  // 4단계: 색상 매핑
  const outData = rawCtx.createImageData(W, H);
  const out8 = outData.data;

  for (let i = 0; i < W * H; i++) {
    const cls = dilated[i];
    let r: number, g: number, b: number;
    if (cls === 1) {
      [r, g, b] = WALL_COLOR;
    } else if (cls === 2) {
      [r, g, b] = FREE_COLOR;
    } else {
      [r, g, b] = UNKNOWN_COLOR;
    }
    const o = i * 4;
    out8[o] = r;
    out8[o + 1] = g;
    out8[o + 2] = b;
    out8[o + 3] = cls === 0 ? 0 : 255;
  }

  // 5단계: 안티앨리어싱
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = W;
  tmpCanvas.height = H;
  const tmpCtx = tmpCanvas.getContext("2d")!;
  tmpCtx.putImageData(outData, 0, 0);

  const UP = 2;
  const upCanvas = document.createElement("canvas");
  upCanvas.width = W * UP;
  upCanvas.height = H * UP;
  const upCtx = upCanvas.getContext("2d")!;
  upCtx.imageSmoothingEnabled = true;
  upCtx.imageSmoothingQuality = "high";
  upCtx.drawImage(tmpCanvas, 0, 0, W * UP, H * UP);

  const offscreen = document.createElement("canvas");
  offscreen.width = W * UP;
  offscreen.height = H * UP;
  const ctx = offscreen.getContext("2d")!;
  ctx.drawImage(upCanvas, 0, 0);

  processedCache.set(src, offscreen);
  return offscreen;
}

/**
 * 3D용 맵 이미지 (벽 라인 제거 — 벽을 바닥과 같은 색으로)
 */
const processed3DCache = new Map<string, HTMLCanvasElement>();

export function processMapImage3D(img: HTMLImageElement, src: string): HTMLCanvasElement {
  const key3d = src + "__3d";
  const cached = processed3DCache.get(key3d);
  if (cached) return cached;

  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const { data: dilated } = buildClassificationMap(img, src);

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = W;
  rawCanvas.height = H;
  const rawCtx = rawCanvas.getContext("2d")!;

  const outData = rawCtx.createImageData(W, H);
  const out8 = outData.data;

  for (let i = 0; i < W * H; i++) {
    const cls = dilated[i];
    let r: number, g: number, b: number;
    if (cls === 1) {
      // 3D에서 벽을 바닥과 동일 색상으로 → 하늘색 라인 제거
      [r, g, b] = FREE_COLOR;
    } else if (cls === 2) {
      [r, g, b] = FREE_COLOR;
    } else {
      [r, g, b] = UNKNOWN_COLOR;
    }
    const o = i * 4;
    out8[o] = r;
    out8[o + 1] = g;
    out8[o + 2] = b;
    out8[o + 3] = cls === 0 ? 0 : 255;
  }

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = W;
  tmpCanvas.height = H;
  const tmpCtx = tmpCanvas.getContext("2d")!;
  tmpCtx.putImageData(outData, 0, 0);

  const UP = 2;
  const upCanvas = document.createElement("canvas");
  upCanvas.width = W * UP;
  upCanvas.height = H * UP;
  const upCtx = upCanvas.getContext("2d")!;
  upCtx.imageSmoothingEnabled = true;
  upCtx.imageSmoothingQuality = "high";
  upCtx.drawImage(tmpCanvas, 0, 0, W * UP, H * UP);

  const offscreen = document.createElement("canvas");
  offscreen.width = W * UP;
  offscreen.height = H * UP;
  const ctx = offscreen.getContext("2d")!;
  ctx.drawImage(upCanvas, 0, 0);

  processed3DCache.set(key3d, offscreen);
  return offscreen;
}

/**
 * 분류맵 가져오기 (2D용 — 벽 팽창 포함)
 */
export function getClassificationMap(img: HTMLImageElement, src: string): { data: Uint8Array; width: number; height: number } {
  return buildClassificationMap(img, src);
}

/**
 * 3D 벽 전용 분류맵 (팽창 없음, 노이즈 강화 필터링)
 * - 벽 팽창 제거 → 실제 벽만 표시
 * - 고립된 벽 픽셀(주변 벽 3개 이하) 제거
 * - 짧은 벽 세그먼트(2px 이하) 제거
 */
const classMap3DCache = new Map<string, { data: Uint8Array; width: number; height: number }>();

export function getClassificationMap3D(img: HTMLImageElement, src: string): { data: Uint8Array; width: number; height: number } {
  const cached = classMap3DCache.get(src);
  if (cached) return cached;

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = W;
  rawCanvas.height = H;
  const rawCtx = rawCanvas.getContext("2d")!;
  rawCtx.drawImage(img, 0, 0);
  const srcData = rawCtx.getImageData(0, 0, W, H);
  const src8 = srcData.data;

  // 1단계: 분류 맵
  const classMap = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const gray = src8[i * 4];
    if (gray <= WALL_THRESH) classMap[i] = 1;
    else if (gray >= FREE_THRESH) classMap[i] = 2;
    else classMap[i] = 0;
  }

  // 2단계: free space만 추출 (class=2), 벽/unknown 무시
  // 3D에서는 원본 벽 데이터를 사용하지 않음 (노이즈 포함)
  // free space 영역의 외곽 경계에만 깨끗한 벽 생성

  // free space 마킹
  const isFree = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (classMap[i] === 2) isFree[i] = 1;
  }

  // free 영역 외곽에만 벽 생성:
  // free 픽셀인데 4방향 중 하나라도 non-free면 → 경계 벽
  const cleaned = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      if (!isFree[idx]) continue;

      if (!isFree[idx - W] || !isFree[idx + W] || !isFree[idx - 1] || !isFree[idx + 1]) {
        cleaned[idx] = 1;
      }
    }
  }

  const result = { data: cleaned, width: W, height: H };
  classMap3DCache.set(src, result);
  return result;
}

/* ── 이미지 로더 캐시 ── */
const imageCache = new Map<string, HTMLImageElement>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached && cached.complete) return Promise.resolve(cached);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageCache.set(src, img);
      resolve(img);
    };
    img.onerror = reject;
    img.src = src;
  });
}
