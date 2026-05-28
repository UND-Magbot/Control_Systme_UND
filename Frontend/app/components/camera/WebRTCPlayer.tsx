"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./WebRTCPlayer.module.css";

type WebRTCPlayerProps = {
  /** MediaMTX WHEP 엔드포인트 URL (예: http://host:8889/video1/whep) */
  whepUrl: string;
  /** <video>에 적용할 클래스 */
  videoClassName?: string;
  /** <video>에 적용할 인라인 스타일 (줌/팬 transform 등) */
  videoStyle?: React.CSSProperties;
  /** 음소거 — 자동재생 정책상 기본 true */
  muted?: boolean;
};

type Status = "connecting" | "playing" | "error";

const RETRY_DELAY_MS = 3000;       // 연결 실패 후 자동 재시도 간격
const ICE_GATHER_TIMEOUT_MS = 2000; // ICE 후보 수집 대기 상한 (LAN은 즉시 끝남)
const CONNECT_TIMEOUT_MS = 12000;   // 이 시간 내 연결 안 되면 재시도

/** ICE 후보 수집이 끝날 때까지(또는 타임아웃) 대기 — non-trickle WHEP */
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

/**
 * MediaMTX WebRTC(WHEP) 저지연 플레이어.
 *
 * recvonly RTCPeerConnection으로 WHEP 협상(offer POST → answer)을 수행하고
 * H.264 트랙을 <video>에 직접 재생한다. 재인코딩이 없어 LAN 기준 수백 ms
 * 수준의 글래스-투-글래스 지연을 얻는다. 연결 실패 시 자동 재연결한다.
 */
export default function WebRTCPlayer({
  whepUrl,
  videoClassName,
  videoStyle,
  muted = true,
}: WebRTCPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  // 수동 "재연결" 버튼 → 값 변경으로 연결 effect 재실행
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let pc: RTCPeerConnection | null = null;
    let resourceUrl: string | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let abort: AbortController | null = null;
    let stopped = false;

    const cleanup = () => {
      if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
      if (abort) { abort.abort(); abort = null; }
      if (pc) {
        try { pc.close(); } catch { /* noop */ }
        pc = null;
      }
      // MediaMTX 세션 해제 (best-effort)
      if (resourceUrl) {
        fetch(resourceUrl, { method: "DELETE" }).catch(() => { /* noop */ });
        resourceUrl = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const scheduleRetry = () => {
      if (stopped) return;
      cleanup();
      setStatus("error");
      retryTimer = setTimeout(() => {
        if (!stopped) void start();
      }, RETRY_DELAY_MS);
    };

    const start = async () => {
      if (stopped) return;
      cleanup();
      if (!whepUrl) {
        setStatus("error");
        return;
      }
      setStatus("connecting");

      // LAN 전용 → STUN/TURN 없이 host candidate만 사용
      pc = new RTCPeerConnection({ iceServers: [] });
      const thisPc = pc;
      abort = new AbortController();

      thisPc.addTransceiver("video", { direction: "recvonly" });

      thisPc.ontrack = (e) => {
        if (videoRef.current && e.streams[0]) {
          videoRef.current.srcObject = e.streams[0];
          videoRef.current.play().catch(() => { /* autoplay 정책 — onPlaying에서 갱신 */ });
        }
      };

      thisPc.onconnectionstatechange = () => {
        if (stopped || pc !== thisPc) return;
        const st = thisPc.connectionState;
        if (st === "connected") {
          if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        } else if (st === "failed" || st === "disconnected") {
          scheduleRetry();
        }
      };

      // 연결 타임아웃 — 시간 내 연결되지 않으면 재시도
      connectTimer = setTimeout(() => {
        if (!stopped && pc === thisPc && thisPc.connectionState !== "connected") {
          scheduleRetry();
        }
      }, CONNECT_TIMEOUT_MS);

      try {
        await thisPc.setLocalDescription(await thisPc.createOffer());
        await waitIceGathering(thisPc, ICE_GATHER_TIMEOUT_MS);
        if (stopped || pc !== thisPc) return;

        const res = await fetch(whepUrl, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: thisPc.localDescription?.sdp ?? "",
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);

        const answerSdp = await res.text();
        // Location 헤더 — 세션 해제용 리소스 URL (상대경로일 수 있어 절대화)
        const loc = res.headers.get("Location");
        if (loc) {
          try { resourceUrl = new URL(loc, whepUrl).toString(); }
          catch { resourceUrl = null; }
        }
        if (stopped || pc !== thisPc) return;
        await thisPc.setRemoteDescription({ type: "answer", sdp: answerSdp });
      } catch {
        if (stopped || pc !== thisPc) return;
        scheduleRetry();
      }
    };

    void start();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      cleanup();
    };
  }, [whepUrl, retryNonce]);

  return (
    <div className={styles.wrapper}>
      <video
        ref={videoRef}
        className={videoClassName}
        style={videoStyle}
        autoPlay
        muted={muted}
        playsInline
        onPlaying={() => setStatus("playing")}
      />
      {status === "connecting" && (
        <div className={styles.overlay}>
          <div className={styles.spinner} />
          <span>연결 중...</span>
        </div>
      )}
      {status === "error" && (
        <div className={styles.overlay}>
          <span>연결 실패</span>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => setRetryNonce((n) => n + 1)}
          >
            재연결
          </button>
        </div>
      )}
    </div>
  );
}
