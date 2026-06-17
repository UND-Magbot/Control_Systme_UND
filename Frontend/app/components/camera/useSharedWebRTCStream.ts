"use client";

import { useEffect, useState } from "react";

/**
 * MediaMTX WHEP 스트림 공유 훅.
 *
 * 같은 whepUrl을 여러 컴포넌트(예: 대시보드 미니 슬롯 + 확대 모달)가 동시에
 * 사용할 때, 각자 별도 RTCPeerConnection을 만들면 동일 path에 reader가 둘 이상
 * 붙어 단일 UDP 멀티플렉싱(:8189)의 5-tuple 충돌로 두 번째 세션이 deadline
 * exceeded로 실패하는 사례가 있다.
 *
 * 이 훅은 module-level registry에 whepUrl을 키로 단일 PeerConnection을 두고
 * 그 MediaStream을 모든 구독자에게 공유한다. refCount가 0이 되는 순간 PC를 닫고
 * MediaMTX 세션도 해제(DELETE)한다.
 *
 * - mediamtx 측 단일 UDP 멀티플렉싱은 그대로 유지 (장점 보존).
 * - 같은 stream을 여러 <video>에 attach 하는 건 브라우저 표준 동작이므로
 *   라이브 미니 + 라이브 확대가 동시에 표시된다.
 */

type Status = "connecting" | "playing" | "error";

type Entry = {
  whepUrl: string;
  pc: RTCPeerConnection | null;
  resourceUrl: string | null;
  stream: MediaStream | null;
  status: Status;
  refCount: number;
  listeners: Set<() => void>;
  connectTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
};

const registry = new Map<string, Entry>();

const ICE_GATHER_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 3000;
// refCount=0 직후 즉시 정리하지 않고 지연시켜, StrictMode 진동·빠른 라우트 전환·
// 사용자가 카메라 탭을 빠르게 왕복하는 경우 같은 entry(PC)를 재사용하게 한다.
// ViewportArea의 토글 race fix(300ms unmount/mount)와 조합되면 같은 카메라로
// 돌아오는 경우 새 PC가 만들어지지 않고 기존 PC를 그대로 재사용한다.
const RELEASE_GRACE_MS = 5000;

function notify(entry: Entry) {
  entry.listeners.forEach((l) => l());
}

function waitIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(finish, timeoutMs);
  });
}

function clearTimers(entry: Entry) {
  if (entry.connectTimer) { clearTimeout(entry.connectTimer); entry.connectTimer = null; }
  if (entry.retryTimer) { clearTimeout(entry.retryTimer); entry.retryTimer = null; }
}

function teardown(entry: Entry) {
  clearTimers(entry);
  if (entry.abort) { entry.abort.abort(); entry.abort = null; }
  if (entry.pc) {
    try { entry.pc.close(); } catch { /* noop */ }
    entry.pc = null;
  }
  if (entry.resourceUrl) {
    fetch(entry.resourceUrl, { method: "DELETE" }).catch(() => { /* noop */ });
    entry.resourceUrl = null;
  }
  entry.stream = null;
}

function scheduleRetry(entry: Entry) {
  teardown(entry);
  entry.status = "error";
  notify(entry);
  entry.retryTimer = setTimeout(() => {
    if (entry.refCount > 0) void startConnection(entry);
  }, RETRY_DELAY_MS);
}

async function startConnection(entry: Entry) {
  teardown(entry);
  if (!entry.whepUrl) {
    entry.status = "error";
    notify(entry);
    return;
  }
  entry.status = "connecting";
  notify(entry);

  // LAN 전용 → STUN/TURN 없이 host candidate만 사용
  const pc = new RTCPeerConnection({ iceServers: [] });
  entry.pc = pc;
  entry.abort = new AbortController();

  pc.addTransceiver("video", { direction: "recvonly" });

  pc.ontrack = (e) => {
    if (entry.pc !== pc) return;
    if (e.streams[0]) {
      entry.stream = e.streams[0];
      entry.status = "playing";
      notify(entry);
    }
  };

  pc.onconnectionstatechange = () => {
    if (entry.pc !== pc) return;
    const st = pc.connectionState;
    if (st === "connected") {
      if (entry.connectTimer) { clearTimeout(entry.connectTimer); entry.connectTimer = null; }
    } else if (st === "failed" || st === "disconnected") {
      scheduleRetry(entry);
    }
  };

  // 연결 타임아웃 — 시간 내 connected가 안 되면 재시도
  entry.connectTimer = setTimeout(() => {
    if (entry.pc === pc && pc.connectionState !== "connected") {
      scheduleRetry(entry);
    }
  }, CONNECT_TIMEOUT_MS);

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
    if (entry.pc !== pc) return;

    const res = await fetch(entry.whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp ?? "",
      signal: entry.abort.signal,
    });
    if (!res.ok) throw new Error(`WHEP ${res.status}`);

    const answerSdp = await res.text();
    const loc = res.headers.get("Location");
    if (loc) {
      try { entry.resourceUrl = new URL(loc, entry.whepUrl).toString(); }
      catch { entry.resourceUrl = null; }
    }
    if (entry.pc !== pc) return;
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  } catch {
    if (entry.pc !== pc) return;
    scheduleRetry(entry);
  }
}

function acquire(whepUrl: string): Entry {
  let entry = registry.get(whepUrl);
  if (!entry) {
    entry = {
      whepUrl,
      pc: null,
      resourceUrl: null,
      stream: null,
      status: "connecting",
      refCount: 0,
      listeners: new Set(),
      connectTimer: null,
      retryTimer: null,
      releaseTimer: null,
      abort: null,
    };
    registry.set(whepUrl, entry);
    void startConnection(entry);
  } else if (entry.releaseTimer) {
    // 정리 예약돼 있었으면 취소 (StrictMode 진동/빠른 재마운트 대응)
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  entry.refCount++;
  return entry;
}

function release(whepUrl: string) {
  const entry = registry.get(whepUrl);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount > 0) return;
  // grace 동안 새 구독자가 붙으면 acquire에서 releaseTimer를 취소한다.
  entry.releaseTimer = setTimeout(() => {
    if (entry.refCount <= 0) {
      teardown(entry);
      registry.delete(whepUrl);
    }
  }, RELEASE_GRACE_MS);
}

export type SharedStream = {
  stream: MediaStream | null;
  status: Status;
  retry: () => void;
};

export function useSharedWebRTCStream(whepUrl: string): SharedStream {
  const [, force] = useState(0);

  useEffect(() => {
    if (!whepUrl) return;

    const entry = acquire(whepUrl);
    const listener = () => force((n) => n + 1);
    entry.listeners.add(listener);
    // 초기 상태 즉시 반영
    force((n) => n + 1);

    return () => {
      entry.listeners.delete(listener);
      release(whepUrl);
    };
  }, [whepUrl]);

  const entry = whepUrl ? registry.get(whepUrl) : undefined;
  return {
    stream: entry?.stream ?? null,
    status: entry?.status ?? "connecting",
    retry: () => {
      if (!whepUrl) return;
      const e = registry.get(whepUrl);
      if (e) void startConnection(e);
    },
  };
}
