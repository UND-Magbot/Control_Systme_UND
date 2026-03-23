'use client';

import styles from './Modal.module.css';
import React, { useState, useEffect, useRef } from 'react';
import type { VideoItem } from '@/app/type';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';


type VideoPlayModalProps = {
    isOpen: boolean;
    onClose: () => void;
    playedVideo: VideoItem | null;
};

export default function VideoPlayModal({
    isOpen,
    onClose,
    playedVideo
}: VideoPlayModalProps) {

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const controlsRef = useRef<HTMLDivElement | null>(null);
    const progressBarRef = useRef<HTMLInputElement | null>(null);
    const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 재생
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);

    // 볼륨
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [prevVolume, setPrevVolume] = useState(1);

    // 전체화면
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);

    // 재생 아이콘 표시
    const [showPlayButton, setShowPlayButton] = useState(false);

    // 로딩/에러
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    // 실시간 progress bar 퍼센트 계산
    const progressPercent = duration ? (currentTime / duration) * 100 : 0;
    const volumePercent = volume * 100;


    // 재생 바 길이 설정
    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (video) {
            setDuration(video.duration || 0);
        }
    };

    // 자동 재생 시작
    const handleAutoPlayStart = () => {
        setIsPlaying(true);
        setShowPlayButton(true);
        setShowControls(true);
        setIsLoading(false);
        startHideTimer();
    };

    // 재생 시 위치 업데이트
    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (video) {
            setCurrentTime(video.currentTime);
        }
    };

    // progress bar 드래그 → 재생 위치 변경
    const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const video = videoRef.current;
        if (!video) return;

        const value = Number(e.target.value);
        const newTime = (value / 100) * duration;
        video.currentTime = newTime;
        setCurrentTime(newTime);
    };

    // 재생 / 일시정지 토글
    const handlePlayPause = () => {
        const video = videoRef.current;
        if (!video || hasError) return;

        if (!video.paused && !video.ended) {
            video.pause();
            setIsPlaying(false);
            clearHideTimer();
            setShowPlayButton(true);
            setShowControls(true);
            return;
        }

        video.play();
        setIsPlaying(true);
        setShowPlayButton(true);
        setShowControls(true);
        startHideTimer();
    };

    // 볼륨 슬라이더 변경
    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const video = videoRef.current;
        if (!video) return;

        const value = Number(e.target.value);
        video.volume = value;
        setVolume(value);

        if (value === 0) {
            setIsMuted(true);
            video.muted = true;
        } else {
            setIsMuted(false);
            video.muted = false;
        }
    };

    // 음소거 토글
    const handleMuteToggle = () => {
        const video = videoRef.current;
        if (!video) return;

        const nextMuted = !isMuted;

        if (nextMuted) {
            setPrevVolume(volume);
            setVolume(0);
            video.volume = 0;
            video.muted = true;
        } else {
            const restored = prevVolume > 0 ? prevVolume : 1;
            setVolume(restored);
            video.volume = restored;
            video.muted = false;
        }

        setIsMuted(nextMuted);
    };

    // 재생 끝났을 때 상태 초기화
    const handleEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
        setShowPlayButton(true);
        setShowControls(true);
        clearHideTimer();
    };

    // 비디오 에러 핸들러
    const handleVideoError = () => {
        setHasError(true);
        setIsLoading(false);
        setIsPlaying(false);
    };

    // 버퍼링 핸들러
    const handleWaiting = () => setIsLoading(true);
    const handleCanPlay = () => setIsLoading(false);

    // 재시도
    const handleRetry = () => {
        const video = videoRef.current;
        if (!video) return;
        setHasError(false);
        setIsLoading(true);
        video.load();
    };


    // 시간 표시 포맷 (mm:ss)
    const formatTime = (time: number) => {
        if (isNaN(time)) return "00:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        const mm = String(minutes).padStart(2, "0");
        const ss = String(seconds).padStart(2, "0");
        return `${mm}:${ss}`;
    };

    const resetVideoState = () => {
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }

        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setIsLoading(true);
        setHasError(false);
    };

    // 전체화면 기능
    const handleFullscreenToggle = async () => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        try {
            if (!document.fullscreenElement) {
                await wrapper.requestFullscreen();
            } else {
                await document.exitFullscreen();
            }
        } catch {
            // fullscreen 요청 실패 시 무시
        }
    };

    useEffect(() => {
        const onFSChange = () => {
            const isFull = !!document.fullscreenElement;
            setIsFullscreen(isFull);
            if (!isFull) {
                setShowControls(true);
            }
        };
        document.addEventListener("fullscreenchange", onFSChange);
        return () => document.removeEventListener("fullscreenchange", onFSChange);
    }, []);

    const clearHideTimer = () => {
        if (hideControlsTimerRef.current) {
            clearTimeout(hideControlsTimerRef.current);
            hideControlsTimerRef.current = null;
        }
    };

    const startHideTimer = () => {
        clearHideTimer();
        hideControlsTimerRef.current = setTimeout(() => {
            setShowPlayButton(false);
            setShowControls(false);
        }, 2000);
    };

    // 마우스 움직임
    const handleMouseMove = () => {
        if (!isPlaying) {
            setShowPlayButton(true);
            setShowControls(true);
            clearHideTimer();
            return;
        }

        setShowPlayButton(true);
        setShowControls(true);
        startHideTimer();
    };

    // 마우스가 나갈 때 — 재생 중이어도 2초 딜레이
    const handleMouseLeave = () => {
        if (!isPlaying) {
            setShowPlayButton(true);
            setShowControls(true);
            clearHideTimer();
            return;
        }

        startHideTimer();
    };

    useEffect(() => {
        if (!progressBarRef.current) return;

        progressBarRef.current.style.background = `
            linear-gradient(
            to right,
            var(--color-accent) ${progressPercent}%,
            #4b5563 ${progressPercent}%
            )
        `;
    }, [progressPercent]);


    // Close Modal
    const handleClosePopup = () => {
        resetVideoState();
        onClose();
    };

    useModalBehavior({
        isOpen,
        onClose: handleClosePopup,
        disabled: !!document.fullscreenElement,
    });

    useEffect(() => {
        if (!isOpen) {
            resetVideoState();
        }
    }, [isOpen]);

    if (!isOpen || !playedVideo) return null;

    const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;

  return (
    <div className={styles.modalOverlay} onClick={handleClosePopup}>
        <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>

            {/* 헤더: 메타 정보 + 닫기 */}
            <div className={styles.vpModalHeader}>
                <span className={styles.vpMetaPrimary}>
                    {playedVideo.robotNo} · {playedVideo.cameraNo}
                </span>
                <span className={styles.vpMetaDot}>·</span>
                <span className={styles.vpMetaType}>
                    <span className={styles.vpTypeIcon}></span>
                    {playedVideo.cameraType}
                </span>
                <button className={styles.vpCloseBtn} onClick={handleClosePopup} aria-label="닫기">✕</button>
            </div>

            {/* 플레이어 */}
            <div className={styles.playerWrapper} ref={wrapperRef}>
                <div className={styles.videoViewBox}
                    onClick={handlePlayPause}
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                >
                    <video className={styles.videoView}
                            ref={videoRef}
                            autoPlay
                            src={"/videos/control_system_sample.mp4"}
                            onLoadedMetadata={handleLoadedMetadata}
                            onTimeUpdate={handleTimeUpdate}
                            onEnded={handleEnded}
                            onPlay={handleAutoPlayStart}
                            onError={handleVideoError}
                            onWaiting={handleWaiting}
                            onCanPlay={handleCanPlay}
                    />

                    {/* 로딩 스피너 */}
                    {isLoading && !hasError && (
                        <div className={styles.vpOverlay} onClick={(e) => e.stopPropagation()}>
                            <div className={styles.vpSpinner}></div>
                        </div>
                    )}

                    {/* 에러 상태 */}
                    {hasError && (
                        <div className={styles.vpOverlay} onClick={(e) => e.stopPropagation()}>
                            <span className={styles.vpErrorText}>영상을 불러올 수 없습니다</span>
                            <button className={styles.vpRetryBtn} onClick={handleRetry}>재시도</button>
                        </div>
                    )}

                    {/* 플레이/일시정지 오버레이 */}
                    {showPlayButton && !hasError && !isLoading && (
                        <button className={styles.vpPlayOverlay} onClick={(e) => { e.stopPropagation(); handlePlayPause(); }} aria-label={isPlaying ? "일시정지" : "재생"}>
                            <img
                                src={isPlaying ? "/icon/pause.png" : "/icon/play-btn.png"}
                                alt={isPlaying ? "Pause" : "Play"}
                            />
                        </button>
                    )}
                </div>

                {/* 컨트롤 바 */}
                <div ref={controlsRef}
                    className={`${styles.controlBox}
                    ${isFullscreen ? styles.fullscreenControls : ''}
                    ${isFullscreen && !showControls ? styles.hide : styles.show}`}
                    onMouseEnter={clearHideTimer}
                    onMouseLeave={() => { if (isPlaying) startHideTimer(); }}
                >
                    {/* 프로그레스바 */}
                    <input ref={progressBarRef} type="range" min={0} max={100} step={0.1} value={progressPercent} onChange={handleSeekChange} className={styles.progressBar} aria-label="재생 위치" />

                    <div className={styles.playBarBox}>
                        <div className={styles.controls}>
                            <button type="button" className={styles.iconBtn} onClick={handlePlayPause} aria-label={isPlaying ? "일시정지" : "재생"}>
                                <img src={isPlaying ? "/icon/pause.png" : "/icon/play-btn.png"} alt={isPlaying ? "Pause" : "Play"} />
                            </button>

                            <button type="button" className={styles.iconBtn} onClick={handleMuteToggle} aria-label={isMuted ? "음소거 해제" : "음소거"}>
                                <img src={isMuted || volume === 0 ? "/icon/sound-btn-off.png" : "/icon/sound-btn.png"} alt={isMuted || volume === 0 ? "Muted" : "Volume"} />
                            </button>

                            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={handleVolumeChange} className={styles.volumeBar} style={{ "--volume-percent": `${volumePercent}%` } as React.CSSProperties} aria-label="볼륨" />

                            <div className={styles.timeText}>
                                <span className={styles.timeCurrent}>{formatTime(currentTime)}</span>
                                <span className={styles.timeSep}> / </span>
                                <span className={styles.timeDuration}>{formatTime(duration)}</span>
                            </div>
                        </div>

                        {canFullscreen && (
                            <button className={styles.iconBtn} onClick={handleFullscreenToggle} aria-label={isFullscreen ? "전체화면 해제" : "전체화면"}>
                                <img src={isFullscreen ? "/icon/exit-full-screen.png" : "/icon/full-screen.png"} alt={isFullscreen ? "Exit Fullscreen" : "Fullscreen"} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}
