"use client";

import { useEffect, useState } from "react";
import { getApiBase } from "@/app/config";

/**
 * 검출 메타데이터(YOLO 박스 + 온도) 구독 훅.
 *
 * 열화상 오버레이를 영상에 굽지 않고 좌표만 받아 브라우저 canvas가 그린다.
 * 영상은 카메라 → MediaMTX → 브라우저로 무재인코딩 통과하므로 어디에서도
 * 디코드/인코드 사이클이 생기지 않는다.
 *
 * 폴러는 모듈 단위 싱글턴 — 카메라가 몇 대든, 뷰가 몇 개든 요청은 하나다.
 * 데이터가 없으면 느리게(1초), 있으면 빠르게(100ms) 돈다. 구독자가 없으면 멈춘다.
 */

export type DetectionBox = {
  /** 박스 종류 — 색 구분용 (person / face / hotpack 등) */
  kind?: string;
  /** 정규화 좌표(0~1) — 검출 해상도와 표시 해상도가 달라도 그대로 쓴다 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 박스에 표시할 문구 (예: "36.5°C") */
  label?: string;
  /** 온도(°C) — 임계값 색상 판정에 쓴다 */
  temp?: number;
};

type PathData = { boxes: DetectionBox[]; age: number };

const POLL_ACTIVE_MS = 100;  // 데이터가 있을 때
const POLL_IDLE_MS = 1000;   // 데이터가 없을 때 — 열화상이 없는 현장에서 낭비하지 않는다

const store = new Map<string, DetectionBox[]>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let subscriberCount = 0;
let currentInterval = POLL_IDLE_MS;

async function pollOnce() {
  const base = getApiBase();
  if (!base) return;
  let hasData = false;
  try {
    const res = await fetch(`${base}/camera/detections`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { paths?: Record<string, PathData> };
    const paths = data.paths ?? {};
    store.clear();
    for (const [name, d] of Object.entries(paths)) {
      if (Array.isArray(d?.boxes) && d.boxes.length > 0) hasData = true;
      store.set(name, d?.boxes ?? []);
    }
  } catch {
    // 조회 실패 — 유령 박스가 남지 않도록 비운다.
    store.clear();
  }
  currentInterval = hasData ? POLL_ACTIVE_MS : POLL_IDLE_MS;
  listeners.forEach((l) => l());
}

function loop() {
  timer = setTimeout(async () => {
    timer = null;
    if (subscriberCount <= 0) return;
    await pollOnce();
    if (subscriberCount > 0) loop();
  }, currentInterval);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  subscriberCount++;
  if (subscriberCount === 1) {
    currentInterval = POLL_IDLE_MS;
    void pollOnce().then(() => { if (subscriberCount > 0 && !timer) loop(); });
  }
  return () => {
    listeners.delete(listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      store.clear();
    }
  };
}

/** pathName에 해당하는 최신 박스 목록. 없으면 빈 배열(= 오버레이를 그리지 않음). */
export function useDetectionOverlay(pathName: string | null): DetectionBox[] {
  const [boxes, setBoxes] = useState<DetectionBox[]>([]);

  useEffect(() => {
    if (!pathName) return;
    const sync = () => setBoxes(store.get(pathName) ?? []);
    const unsubscribe = subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      setBoxes([]);
    };
  }, [pathName]);

  return boxes;
}
