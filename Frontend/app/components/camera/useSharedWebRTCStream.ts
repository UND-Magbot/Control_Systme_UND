"use client";

import { useEffect, useState } from "react";
import { getApiBase } from "@/app/config";

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
 * ── 재연결 정책 (CAMERA_RECONNECT_DESIGN.md) ─────────────────────────────
 * 재연결은 "시간이 됐으니"가 아니라 "붙을 가능성이 생겼으니" 시도한다.
 *
 *  ① Gate      MediaMTX가 로봇 RTSP를 물고 있는지(ready)를 백엔드 프록시로 확인.
 *              ready=false(발행자 없음)면 실패로 세지 않고 대기 — 신호가 오면 즉시 붙는다.
 *  ② Backoff   ready=true인데 실패하면 그때만 간격을 늘린다(1s → ×1.8 → 30s).
 *  ③ Breaker   연속 실패가 상한을 넘으면 자동 재시도를 끊고 사용자 조작을 기다린다.
 *
 * 그리고 WebRTC의 `disconnected`는 스스로 회복되는 경우가 많으므로 즉시 죽이지 않고
 * 유예를 준다. (유예 없이 teardown 하면 회복될 연결을 끊어 영구 정지가 된다.)
 */

// idle       = 구독자가 있으나 아무도 연결을 활성화(enable)하지 않은 대기 상태.
// connecting = 최초 연결 시도 중.
// playing    = 정상 재생.
// recovering = 일시 끊김 — 자동 복구 시도 중(직전 프레임을 지우지 않는다).
// waiting    = 카메라에서 영상이 오지 않음(ready=false). 신호가 오면 자동 연결.
// error      = 자동 복구 포기(브레이커). 사용자의 '다시 연결'로만 재개.
type Status =
  | "idle"
  | "connecting"
  | "playing"
  | "recovering"
  | "waiting"
  | "error";

type Entry = {
  whepUrl: string;
  /** MediaMTX path 이름 — readiness 조회 키. whepUrl에서 파생. */
  pathName: string | null;
  pc: RTCPeerConnection | null;
  resourceUrl: string | null;
  stream: MediaStream | null;
  status: Status;
  refCount: number;
  // enable 투표 수 — 1 이상일 때만 연결/재연결을 시도한다.
  enabledCount: number;
  listeners: Set<() => void>;
  connectTimer: ReturnType<typeof setTimeout> | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  /** disconnected 유예 타이머 — 만료 전에 회복되면 아무 일도 일어나지 않는다. */
  graceTimer: ReturnType<typeof setTimeout> | null;
  abort: AbortController | null;
  /** 다음 재시도까지의 대기(ms) — ②Backoff */
  backoffMs: number;
  /** 연속 실패 횟수 — ③Breaker. ready=false는 세지 않는다. */
  failCount: number;
  /** ready=true가 연속으로 몇 번 관측됐는지 — 플랩 방지용 디바운스 */
  readyStreak: number;
  /** 직전 폴링에서 관측한 ready — false→true 전이(소스 복귀)를 잡는다. */
  lastReady: boolean | null;
};

const registry = new Map<string, Entry>();

const ICE_GATHER_TIMEOUT_MS = 2000;
const CONNECT_TIMEOUT_MS = 12000;
// refCount=0 직후 즉시 정리하지 않고 지연시켜, StrictMode 진동·빠른 라우트 전환·
// 사용자가 카메라 탭을 빠르게 왕복하는 경우 같은 entry(PC)를 재사용하게 한다.
const RELEASE_GRACE_MS = 5000;
// 일시 끊김 유예 — 이 안에 스스로 회복되면 사용자는 아무것도 눈치채지 못한다.
const DISCONNECT_GRACE_MS = 6000;
// ②Backoff / ③Breaker — 백엔드 _CameraStream(camera.py) 및 useCameraStream과 같은 규약.
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const BACKOFF_FACTOR = 1.8;
const BREAKER_THRESHOLD = 5;
// ①Gate — readiness 폴링.
const READY_POLL_MS = 5000;
const READY_DEBOUNCE = 2; // 연속 2회(≈10초) ready여야 게이트를 연다

/** whepUrl(".../{path}/whep")에서 MediaMTX path 이름을 뽑는다. */
function pathNameFromWhep(url: string): string | null {
  const m = url.match(/\/([^/]+)\/whep\/?$/);
  return m ? m[1] : null;
}

// ── ①Gate: readiness 폴러 (모듈 단위 싱글턴) ────────────────────────────
// 카메라가 몇 대든 요청은 하나다(백엔드가 paths/list 1회로 전부 돌려준다).
// 활성 구독자가 하나도 없으면 폴링을 멈춘다.
const readiness = {
  /** 백엔드/MediaMTX 조회가 가능한 상태인지. false면 '판단 불가'. */
  available: false,
  paths: new Map<string, boolean>(),
};
let readyTimer: ReturnType<typeof setInterval> | null = null;

/**
 * entry의 소스가 살아있는지.
 * true=발행 중 / false=발행자 없음 / null=판단 불가(조회 실패·path 미상)
 *
 * null을 false로 취급하면 안 된다 — 조회 실패로 연결을 막으면 라이브 화면이
 * 백엔드에 종속되어, 카메라 채널을 관제 폴링에서 분리한 설계가 무너진다.
 */
function pathReadyOf(entry: Entry): boolean | null {
  if (!readiness.available || !entry.pathName) return null;
  return readiness.paths.get(entry.pathName) ?? false;
}

async function pollReadiness() {
  const base = getApiBase();
  if (!base) return;
  try {
    const res = await fetch(`${base}/camera/stream-status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      available?: boolean;
      paths?: Record<string, { ready?: boolean }>;
    };
    readiness.available = !!data.available;
    readiness.paths.clear();
    for (const [name, info] of Object.entries(data.paths ?? {})) {
      readiness.paths.set(name, !!info?.ready);
    }
  } catch {
    // 조회 실패 = 판단 불가. 게이트를 닫지 않는다(§2.4 폴백 규칙).
    readiness.available = false;
    readiness.paths.clear();
  }
  onReadinessUpdated();
}

/** 활성 구독자가 있으면 폴링을 켜고, 없으면 끈다. */
function syncReadinessPolling() {
  let active = false;
  registry.forEach((e) => {
    if (e.refCount > 0 && e.enabledCount > 0) active = true;
  });
  if (active && !readyTimer) {
    void pollReadiness();
    readyTimer = setInterval(() => void pollReadiness(), READY_POLL_MS);
  } else if (!active && readyTimer) {
    clearInterval(readyTimer);
    readyTimer = null;
  }
}

/**
 * 폴링 결과 반영.
 *  - waiting : ready가 연속 관측되면 연결을 재개한다.
 *  - error   : 브레이커가 열렸어도 소스가 죽었다 살아나면(false→true) 다시 열어준다.
 *              "될 가능성이 새로 생겼다"는 신호이므로, 사용자가 누르지 않아도 복구된다.
 *              (ready가 계속 true인 채 실패해 온 경우에는 재개하지 않는다 — 그건
 *               재시도해도 안 되는 상황이라 브레이커의 존재 이유다.)
 */
function onReadinessUpdated() {
  registry.forEach((entry) => {
    if (entry.refCount <= 0 || entry.enabledCount <= 0) return;

    const ready = pathReadyOf(entry);
    const prev = entry.lastReady;
    entry.lastReady = ready;

    if (entry.status === "error") {
      if (prev === false && ready === true) {
        entry.failCount = 0;
        entry.backoffMs = BACKOFF_MIN_MS;
        entry.readyStreak = 0;
        void startConnection(entry);
      }
      return;
    }

    if (entry.status !== "waiting") return;

    if (ready === false) {
      entry.readyStreak = 0;
      return;
    }
    // ready=true 또는 판단 불가 — 붙을 가능성이 생겼다.
    entry.readyStreak += 1;
    if (entry.readyStreak < READY_DEBOUNCE) return; // 플랩 방지
    entry.readyStreak = 0;
    // 신호에 의한 재개이므로 백오프를 초기화한다(느린 재시도로 시작하지 않는다).
    entry.backoffMs = BACKOFF_MIN_MS;
    void startConnection(entry);
  });
}

// ── 내부 유틸 ────────────────────────────────────────────────────────────
function notify(entry: Entry) {
  entry.listeners.forEach((l) => l());
}

function setStatus(entry: Entry, status: Status) {
  if (entry.status === status) return;
  entry.status = status;
  notify(entry);
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
  if (entry.graceTimer) { clearTimeout(entry.graceTimer); entry.graceTimer = null; }
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

/** 연결이 살아 돌아옴 — 백오프·실패횟수를 되돌린다. */
function markHealthy(entry: Entry) {
  if (entry.graceTimer) { clearTimeout(entry.graceTimer); entry.graceTimer = null; }
  if (entry.connectTimer) { clearTimeout(entry.connectTimer); entry.connectTimer = null; }
  entry.failCount = 0;
  entry.backoffMs = BACKOFF_MIN_MS;
}

/** 발행자 없음 — 실패로 세지 않고 신호를 기다린다. */
function enterWaiting(entry: Entry) {
  entry.readyStreak = 0;
  setStatus(entry, "waiting");
}

/**
 * 연결 실패/끊김 확정 처리 — ①Gate로 원인을 가르고 ②Backoff·③Breaker를 적용한다.
 *
 *  ready=false → 로봇/카메라가 안 보내는 것. 우리 잘못이 아니므로 실패로 세지 않고 대기.
 *  ready=true  → 소스는 있는데 협상·전송이 실패. 이때만 간격을 늘리고 횟수를 센다.
 *  판단 불가    → ready=true와 같게 취급(게이트를 닫지 않는다).
 */
function onFailure(entry: Entry) {
  if (entry.enabledCount <= 0) { stopConnection(entry); return; }

  const ready = pathReadyOf(entry);
  teardown(entry);

  if (ready === false) {
    entry.failCount = 0;
    entry.backoffMs = BACKOFF_MIN_MS;
    enterWaiting(entry);
    return;
  }

  entry.failCount += 1;
  if (entry.failCount >= BREAKER_THRESHOLD) {
    // ③Breaker 개방 — 자동 재시도를 끊는다. 사용자의 '다시 연결'로만 재개.
    setStatus(entry, "error");
    return;
  }

  setStatus(entry, "recovering");
  const delay = entry.backoffMs;
  entry.backoffMs = Math.min(delay * BACKOFF_FACTOR, BACKOFF_MAX_MS);
  entry.retryTimer = setTimeout(() => {
    entry.retryTimer = null;
    if (entry.refCount > 0 && entry.enabledCount > 0) void startConnection(entry);
  }, delay);
}

// enable 투표가 0이 됨 → 연결을 끊고 재시도 없이 대기(idle) 상태로.
function stopConnection(entry: Entry) {
  teardown(entry);
  entry.failCount = 0;
  entry.backoffMs = BACKOFF_MIN_MS;
  entry.readyStreak = 0;
  setStatus(entry, "idle");
}

async function startConnection(entry: Entry) {
  // 비활성(로봇 오프라인/모듈 OFF) 상태면 연결을 시작하지 않는다.
  if (entry.enabledCount <= 0) { stopConnection(entry); return; }
  teardown(entry);
  if (!entry.whepUrl) {
    setStatus(entry, "error");
    return;
  }
  // 직전 프레임이 있으면 '다시 연결 중', 최초면 '연결 중'.
  setStatus(entry, entry.failCount > 0 ? "recovering" : "connecting");

  // LAN 전용 → STUN/TURN 없이 host candidate만 사용
  const pc = new RTCPeerConnection({ iceServers: [] });
  entry.pc = pc;
  entry.abort = new AbortController();

  pc.addTransceiver("video", { direction: "recvonly" });

  pc.ontrack = (e) => {
    if (entry.pc !== pc) return;
    if (e.streams[0]) {
      entry.stream = e.streams[0];
      markHealthy(entry);
      setStatus(entry, "playing");
      notify(entry); // stream 교체 자체를 구독자에게 알린다
    }
  };

  pc.onconnectionstatechange = () => {
    if (entry.pc !== pc) return;
    const st = pc.connectionState;

    if (st === "connected") {
      markHealthy(entry);
      if (entry.stream) setStatus(entry, "playing");
      return;
    }

    if (st === "disconnected") {
      // 일시 끊김 — 스스로 회복되는 경우가 많다. PC를 죽이지 말고 유예를 준다.
      // (여기서 teardown 하면 회복될 연결을 끊어 영구 정지가 된다.)
      if (entry.graceTimer) return; // 이미 유예 중
      setStatus(entry, "recovering");
      entry.graceTimer = setTimeout(() => {
        entry.graceTimer = null;
        if (entry.pc !== pc) return;
        if (pc.connectionState === "connected") return; // 스스로 회복됨
        onFailure(entry);
      }, DISCONNECT_GRACE_MS);
      return;
    }

    if (st === "failed") {
      // ICE가 포기 — 유예 없이 실패 처리.
      onFailure(entry);
    }
  };

  // 연결 타임아웃 — 시간 내 connected가 안 되면 실패 처리
  entry.connectTimer = setTimeout(() => {
    if (entry.pc === pc && pc.connectionState !== "connected") {
      onFailure(entry);
    }
  }, CONNECT_TIMEOUT_MS);

  try {
    await pc.setLocalDescription(await pc.createOffer());
    await waitIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
    if (entry.pc !== pc) return;

    let res: Response;
    try {
      res = await fetch(entry.whepUrl, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: pc.localDescription?.sdp ?? "",
        signal: entry.abort.signal,
      });
    } catch (err) {
      if (entry.pc !== pc) return;
      // abort에 의한 취소는 정상 흐름이므로 무시.
      if ((err as Error)?.name === "AbortError") return;
      // fetch 자체가 reject = MediaMTX에 도달 불가.
      onFailure(entry);
      return;
    }
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
    // WHEP 404(발행자 없음) 포함 — onFailure가 readiness로 원인을 가른다.
    onFailure(entry);
  }
}

function acquire(whepUrl: string): Entry {
  let entry = registry.get(whepUrl);
  if (!entry) {
    entry = {
      whepUrl,
      pathName: pathNameFromWhep(whepUrl),
      pc: null,
      resourceUrl: null,
      stream: null,
      // 연결은 enable 투표(vote)가 들어와야 시작한다 — 초기엔 idle.
      status: "idle",
      refCount: 0,
      enabledCount: 0,
      listeners: new Set(),
      connectTimer: null,
      retryTimer: null,
      releaseTimer: null,
      graceTimer: null,
      abort: null,
      backoffMs: BACKOFF_MIN_MS,
      failCount: 0,
      readyStreak: 0,
      lastReady: null,
    };
    registry.set(whepUrl, entry);
  } else if (entry.releaseTimer) {
    // 정리 예약돼 있었으면 취소 (StrictMode 진동/빠른 재마운트 대응)
    clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  entry.refCount++;
  return entry;
}

// enable 투표 증감. 0→1로 올라가면 연결 시작, 1→0으로 내려가면 연결 정지.
function vote(entry: Entry, delta: number) {
  const prev = entry.enabledCount;
  entry.enabledCount = Math.max(0, prev + delta);
  if (prev === 0 && entry.enabledCount > 0) {
    void startConnection(entry);
  } else if (prev > 0 && entry.enabledCount === 0) {
    stopConnection(entry);
  }
  syncReadinessPolling();
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
      syncReadinessPolling();
    }
  }, RELEASE_GRACE_MS);
}

export type SharedStream = {
  stream: MediaStream | null;
  status: Status;
  retry: () => void;
};

export function useSharedWebRTCStream(whepUrl: string, enabled: boolean = true): SharedStream {
  const [, force] = useState(0);

  // enabled가 바뀌면 cleanup이 직전 enabled(캡처값)로 vote를 되돌리고, 새 effect가
  // 새 enabled로 다시 투표한다 → 투표 수가 항상 균형을 이룬다. refCount도 동일하게
  // 증감하지만 RELEASE_GRACE_MS 덕에 PC는 유지되고, 연결 시작/정지는 vote가 결정한다.
  useEffect(() => {
    if (!whepUrl) return;

    const entry = acquire(whepUrl);
    if (enabled) vote(entry, +1);
    else syncReadinessPolling();
    const listener = () => force((n) => n + 1);
    entry.listeners.add(listener);
    // 초기 상태 즉시 반영
    force((n) => n + 1);

    return () => {
      if (enabled) vote(entry, -1);
      entry.listeners.delete(listener);
      release(whepUrl);
    };
  }, [whepUrl, enabled]);

  const entry = whepUrl ? registry.get(whepUrl) : undefined;
  return {
    stream: entry?.stream ?? null,
    status: entry?.status ?? "idle",
    retry: () => {
      if (!whepUrl) return;
      const e = registry.get(whepUrl);
      // 비활성 상태에서는 수동 재연결도 무시(연결 시도가 다시 루프를 만들지 않도록).
      if (!e || e.enabledCount <= 0) return;
      // 사용자가 명시적으로 눌렀다 — 브레이커와 백오프를 초기화한다.
      e.failCount = 0;
      e.backoffMs = BACKOFF_MIN_MS;
      e.readyStreak = 0;
      void startConnection(e);
    },
  };
}
