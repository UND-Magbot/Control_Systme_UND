"use client";

import React, { useEffect, useRef } from "react";
import styles from "./WebRTCPlayer.module.css";
import { useSharedWebRTCStream } from "./useSharedWebRTCStream";

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
}: WebRTCPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { stream, status, retry } = useSharedWebRTCStream(whepUrl);

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
            onClick={retry}
          >
            재연결
          </button>
        </div>
      )}
    </div>
  );
}
