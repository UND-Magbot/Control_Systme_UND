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

type Status = "connecting" | "playing" | "reconnecting" | "error";

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
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
  retryAttempts: number;   // 연속 재연결 시도 횟수 (백오프 계산용)
  everPlayed: boolean;     // 한 번이라도 재생된 적 있는가 (마지막 프레임 유지 판단)
  reconnectSince: number;  // 끊김이 시작된 시각(ms) — 0이면 정상
};

const registry = new Map<string, Entry>();

const ICE_GATHER_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 12000;
// 재연결 백오프 — 혼잡 무선에서 고정 간격으로 계속 두드리면 경합을 키우므로
// 지수적으로 늘린다(성공 시 0으로 리셋).
const RETRY_DELAY_BASE_MS = 2000;
const RETRY_DELAY_MAX_MS = 15000;
// ICE 'disconnected'는 대개 스스로 복구되므로 즉시 끊지 않고 이만큼 기다린다.
const DISCONNECT_GRACE_MS = 4000;
// 끊김이 이 시간을 넘기면 '마지막 프레임 유지'를 멈추고 '연결 실패' UI로 전환.
const HARD_ERROR_AFTER_MS = 30000;
// refCount=0 직후 즉시 정리하지 않고 지연시켜, StrictMode 진동·빠른 라우트 전환·
// 사용자가 카메라 탭을 빠르게 왕복하는 경우 같은 entry(PC)를 재사용하게 한다.
// ViewportArea의 토글 race fix(300ms unmount/mount)와 조합되면 같은 카메라로
// 돌아오는 경우 새 PC가 만들어지지 않고 기존 PC를 그대로 재사용한다.
const RELEASE_GRACE_MS = 5000;
// 수신 지터버퍼 목표 지연(ms). 낮을수록 저지연이지만 무선 지터 시 작은 끊김↑.
// 0 = 최소 버퍼('쌓였다 빨리감기'·백로그 최소화). 너무 거칠면 100~200으로 올려 절충.
const JITTER_BUFFER_TARGET_MS = 0;

// 표준 jitterBufferTarget(ms)와 구 Chrome playoutDelayHint(초)를 모두 노출하는 형태.
type LowLatencyReceiver = RTCRtpReceiver & {
  jitterBufferTarget?: number | null;
  playoutDelayHint?: number;
};

// 수신 트랙의 지터버퍼를 최소화해 '느리다 갑자기 빨리감기/순간이동' 현상을 완화한다.
// 표준(jitterBufferTarget)·비표준(playoutDelayHint)을 모두 시도, 미지원이면 조용히 무시.
function applyLowLatency(receiver: RTCRtpReceiver) {
  const r = receiver as LowLatencyReceiver;
  try { r.jitterBufferTarget = JITTER_BUFFER_TARGET_MS; } catch { /* 미지원 무시 */ }
  try { r.playoutDelayHint = JITTER_BUFFER_TARGET_MS / 1000; } catch { /* 미지원 무시 */ }
}

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
  if (entry.disconnectTimer) { clearTimeout(entry.disconnectTimer); entry.disconnectTimer = null; }
}

// keepStream=true면 마지막 MediaStream 참조를 남겨 <video>가 마지막 프레임을
// 계속 보여주게 한다(일시 재연결 중 화면이 검게 깜빡이는 것을 방지).
function teardown(entry: Entry, keepStream = false) {
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
  if (!keepStream) entry.stream = null;
}

function scheduleRetry(entry: Entry) {
  if (entry.reconnectSince === 0) entry.reconnectSince = Date.now();
  // 한 번이라도 재생됐고 끊긴 지 얼마 안 됐으면 마지막 프레임을 유지한 채
  // 조용히 재연결('reconnecting'). 오래 지속되거나 한 번도 못 봤으면 'error'.
  const soft = entry.everPlayed && (Date.now() - entry.reconnectSince) < HARD_ERROR_AFTER_MS;
  teardown(entry, soft);
  entry.status = soft ? "reconnecting" : "error";
  notify(entry);
  const delay = Math.min(RETRY_DELAY_BASE_MS * 2 ** entry.retryAttempts, RETRY_DELAY_MAX_MS);
  entry.retryAttempts++;
  entry.retryTimer = setTimeout(() => {
    if (entry.refCount > 0) void startConnection(entry);
  }, delay);
}

async function startConnection(entry: Entry) {
  // 재연결 중이면 마지막 프레임을 유지(검은 화면 방지), 최초 연결이면 비운다.
  const keepLast = entry.everPlayed;
  teardown(entry, keepLast);
  if (!entry.whepUrl) {
    entry.status = "error";
    notify(entry);
    return;
  }
  entry.status = keepLast ? "reconnecting" : "connecting";
  notify(entry);

  // LAN 전용 → STUN/TURN 없이 host candidate만 사용
  const pc = new RTCPeerConnection({ iceServers: [] });
  entry.pc = pc;
  entry.abort = new AbortController();

  pc.addTransceiver("video", { direction: "recvonly" });

  pc.ontrack = (e) => {
    if (entry.pc !== pc) return;
    applyLowLatency(e.receiver);
    if (e.streams[0]) {
      entry.stream = e.streams[0];
      entry.status = "playing";
      entry.everPlayed = true;
      entry.retryAttempts = 0;
      entry.reconnectSince = 0;
      notify(entry);
    }
  };

  pc.onconnectionstatechange = () => {
    if (entry.pc !== pc) return;
    const st = pc.connectionState;
    if (st === "connected") {
      if (entry.connectTimer) { clearTimeout(entry.connectTimer); entry.connectTimer = null; }
      if (entry.disconnectTimer) { clearTimeout(entry.disconnectTimer); entry.disconnectTimer = null; }
      // 자가복구 — 끊김 카운터 리셋, 재생 중이던 스트림이면 상태 복원
      entry.retryAttempts = 0;
      entry.reconnectSince = 0;
      if (entry.everPlayed && entry.status !== "playing") {
        entry.status = "playing";
        notify(entry);
      }
    } else if (st === "disconnected") {
      // ICE 일시 끊김은 대개 스스로 복구되므로 grace 동안 기다린다.
      // 이 사이 stream은 그대로 두어 마지막 프레임이 유지된다(깜빡임 방지).
      if (!entry.disconnectTimer) {
        if (entry.reconnectSince === 0) entry.reconnectSince = Date.now();
        entry.disconnectTimer = setTimeout(() => {
          entry.disconnectTimer = null;
          if (entry.pc === pc && pc.connectionState !== "connected") scheduleRetry(entry);
        }, DISCONNECT_GRACE_MS);
      }
    } else if (st === "failed") {
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
      disconnectTimer: null,
      releaseTimer: null,
      abort: null,
      retryAttempts: 0,
      everPlayed: false,
      reconnectSince: 0,
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
      if (e) {
        e.retryAttempts = 0;
        e.reconnectSince = 0;
        void startConnection(e);
      }
    },
  };
}
