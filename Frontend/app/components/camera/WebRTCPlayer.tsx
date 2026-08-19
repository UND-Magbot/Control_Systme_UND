"use client";

import React, { useEffect, useRef } from "react";
import styles from "./WebRTCPlayer.module.css";
import { useSharedWebRTCStream } from "./useSharedWebRTCStream";
import { STREAM_COPY, LIVE_LABEL, RETRY_LABEL, type StreamPhase } from "./streamStatusCopy";
import DetectionOverlay from "./DetectionOverlay";

type WebRTCPlayerProps = {
  /** MediaMTX WHEP 엔드포인트 URL (예: http://host:8889/video1/whep) */
  whepUrl: string;
  /** <video>에 적용할 클래스 */
  videoClassName?: string;
  /** <video>에 적용할 인라인 스타일 (줌/팬 transform 등) */
  videoStyle?: React.CSSProperties;
  /** 음소거 — 자동재생 정책상 기본 true */
  muted?: boolean;
  /**
   * false면 연결·재연결을 멈추고 대기 오버레이를 표시한다.
   * 로봇이 오프라인이거나 카메라 모듈이 OFF인 경우 false로 내려 무한 재연결을 막는다.
   */
  enabled?: boolean;
  /** 비활성(enabled=false) 시 오버레이에 표시할 문구 (기본 "연결 대기") */
  disabledLabel?: string;
};

/**
 * MediaMTX WebRTC(WHEP) 저지연 플레이어.
 *
 * 같은 whepUrl을 사용하는 모든 인스턴스는 useSharedWebRTCStream을 통해
 * 단일 RTCPeerConnection의 MediaStream을 공유한다. 미니/확대/원격 모달 등
 * 여러 곳에서 같은 카메라를 동시에 라이브로 봐도 MediaMTX reader는 1개로
 * 유지되며, 단일 UDP 멀티플렉싱(:8189)에서 동시 세션이 늘어날 때 일부가
 * connectivity check를 놓치는 한계를 회피한다.
 */
export default function WebRTCPlayer({
  whepUrl,
  videoClassName,
  videoStyle,
  muted = true,
  enabled = true,
  disabledLabel = "연결 대기",
}: WebRTCPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { stream, status, retry } = useSharedWebRTCStream(whepUrl, enabled);

  // 검출 오버레이(열화상 박스·온도)를 붙일 MediaMTX path.
  // 해당 path의 검출 결과가 없으면 아무것도 그리지 않으므로, 어떤 카메라에 붙어도 무해하다.
  const detectionPath = React.useMemo(() => {
    const m = whepUrl.match(/\/([^/]+)\/whep\/?$/);
    return m ? m[1] : null;
  }, [whepUrl]);

  // 훅 상태 → 사용자에게 보여줄 문구. playing이면 오버레이 없음(null).
  const phase: StreamPhase | null = !enabled
    ? "disabled"
    : status === "playing"
      ? null
      : status === "idle"
        ? "connecting"
        : status;
  const copy = STREAM_COPY[phase ?? "connecting"];

  // 공유 스트림을 <video>에 attach. stream 교체/언마운트 시 명시적 해제로
  // track ref가 남는 것을 막는다.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) {
      v.play().catch(() => { /* autoplay 정책 — 일부 환경에서 무시 가능 */ });
    }
    return () => {
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={styles.wrapper}>
      <video
        ref={videoRef}
        className={videoClassName}
        style={videoStyle}
        autoPlay
        muted={muted}
        playsInline
      />
      {/* 검출 박스·온도 — 영상에 굽지 않고 좌표만 받아 여기서 그린다 */}
      {enabled && status === "playing" && <DetectionOverlay pathName={detectionPath} />}

      {/* LIVE 배지 */}
      {enabled && status === "playing" && (
        <span className={`${styles.badge} ${styles.badgeLive}`}>
          <span className={`${styles.badgeDot} ${styles.badgeLiveDot}`} />
          {LIVE_LABEL}
        </span>
      )}

      {phase && (
        // 'recovering'은 마지막 프레임을 살려두고 그 위에 옅게 덮는다 —
        // 잠깐의 끊김에 화면이 까맣게 되면 사용자는 고장으로 오해한다.
        <div className={`${styles.overlay} ${phase === "recovering" ? styles.overlaySoft : ""}`}>
          {copy.spinner ? (
            <div className={styles.spinner} />
          ) : phase === "waiting" || phase === "error" ? (
            <svg className={styles.noSignalIcon} width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /><line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          ) : null}
          <span className={phase === "connecting" || phase === "disabled" ? undefined : styles.msgAmber}>
            {phase === "disabled" ? disabledLabel : copy.title}
          </span>
          {copy.desc && <span className={styles.overlayDesc}>{copy.desc}</span>}
          {copy.retry && (
            <button type="button" className={styles.retryBtn} onClick={retry}>
              {RETRY_LABEL}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
