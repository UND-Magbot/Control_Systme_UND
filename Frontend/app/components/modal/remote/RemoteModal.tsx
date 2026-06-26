'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { RobotRowData, Video, Camera, PrimaryViewType } from '@/app/types';
import { getCamerasForRobot } from '@/app/lib/cameraView';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useRobotPosition } from '@/app/hooks/useRobotPosition';
import { apiFetch } from '@/app/lib/api';

import { useCameraStream } from './hooks/useCameraStream';
import { useWorkAutomation } from './hooks/useWorkAutomation';
import { useRemoteCommand } from './hooks/useRemoteCommand';
import { useKeyboardControls } from './hooks/useKeyboardControls';
import { useRecording } from './hooks/useRecording';

import StatusBar from './components/StatusBar';
import ViewportArea from './components/ViewportArea';
import { useRemoteFloorMap } from './hooks/useRemoteFloorMap';
import MovementPad from './components/MovementPad';
import ControlPanel from './components/ControlPanel';
import AlertDialog from './components/AlertDialog';
import styles from './RemoteModal.module.css';

export type RemoteModalProps = {
  isOpen: boolean;
  onClose: () => void;
  selectedRobots: RobotRowData | null;
  robots: RobotRowData[];
  video: Video[];
  camera: Camera[];
  initialCam?: Camera | null;
  initialCamIndex?: number;
  primaryView: PrimaryViewType;
  readOnly?: boolean;
  controlledBy?: string | null;
};

export default function RemoteModal({
  isOpen,
  onClose,
  selectedRobots,
  robots: _robots,
  video: _video,
  camera,
  initialCam,
  initialCamIndex,
  primaryView: _primaryView,
  readOnly = false,
  controlledBy,
}: RemoteModalProps) {
  // --- 선택된 로봇 ---
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

  useEffect(() => {
    setSelectedRobot(selectedRobots);
  }, [selectedRobots]);

  // --- 층 id → 이름 매핑 (현재 층 배지용, 모달 열릴 때 1회 로드) ---
  const [floorNameById, setFloorNameById] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    apiFetch(`/map/floors`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { id: number; FloorName: string }[]) => {
        if (cancelled || !Array.isArray(data)) return;
        const map: Record<number, string> = {};
        for (const f of data) map[f.id] = f.FloorName;
        setFloorNameById(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen]);

  const floorName =
    selectedRobot?.currentFloorId != null
      ? (floorNameById[selectedRobot.currentFloorId] ?? null)
      : null;

  // --- 로봇별 카메라 동적 로드 ---
  const [robotCameras, setRobotCameras] = useState<Camera[]>(camera);
  const [camerasReady, setCamerasReady] = useState(false);

  useEffect(() => {
    if (!isOpen || !selectedRobot) {
      setRobotCameras(camera);
      setCamerasReady(camera.length > 0);
      return;
    }
    setCamerasReady(false);
    let cancelled = false;
    getCamerasForRobot(selectedRobot.id).then((cams) => {
      if (cancelled) return;
      const result = cams.length > 0 ? cams : camera;
      setRobotCameras(result);
      setCamerasReady(true);
    });
    return () => { cancelled = true; };
  }, [isOpen, selectedRobot?.id, camera]);

  // --- 커스텀 알림 ---
  const [alertMsg, setAlertMsg] = useState<string | null>(null);
  const showAlert = useCallback((msg: string) => setAlertMsg(msg), []);

  // --- 로봇 위치/연결 상태 (연결 끊김 감지 → 카메라 재연결 게이트에 사용) ---
  const { position: robotPos, isReady: robotConnected, hasError: positionError } = useRobotPosition(isOpen);

  // 연결 끊김 감지
  const errorCountRef = useRef(0);
  const [isDisconnected, setIsDisconnected] = useState(false);

  useEffect(() => {
    if (positionError) {
      errorCountRef.current += 1;
      if (errorCountRef.current >= 3) setIsDisconnected(true);
    } else {
      errorCountRef.current = 0;
      setIsDisconnected(false);
    }
  }, [positionError]);

  // --- 커스텀 훅 (카메라 준비 후에만 활성화) ---
  // 로봇 통신이 끊기면(isDisconnected) 카메라 연결·재연결을 멈춘다.
  const cam = useCameraStream({
    isOpen: isOpen && camerasReady,
    camera: robotCameras,
    initialCam,
    initialCamIndex,
    enabled: !isDisconnected,
  });
  const work = useWorkAutomation(isOpen, {
    onAlert: showAlert,
    currentFloorId: selectedRobot?.currentFloorId ?? null,
  });
  // 로봇 현재 층의 실제 맵 (없으면 null → ViewportArea가 고정 맵으로 폴백)
  const floorMapConfig = useRemoteFloorMap(selectedRobot?.currentFloorId ?? null);
  const moveCmd = useRemoteCommand({ debounceMs: 100, onError: showAlert });
  const recording = useRecording(isOpen, selectedRobot?.id);

  // --- 키보드 이동 제어 ---
  const handleMove = useCallback(
    (endpoint: string) => { moveCmd.execute(endpoint); },
    [moveCmd],
  );

  const handleStop = useCallback(() => {
    apiFetch('/robot/stop', { method: 'POST' }).catch(() => {});
  }, []);

  const keyboardEnabled = isOpen && !readOnly && !work.isWorking && !isDisconnected;
  const { activeKey: activeKeyRef } = useKeyboardControls({
    enabled: keyboardEnabled,
    onMove: handleMove,
    onStop: handleStop,
  });

  // --- 모달 닫기 ---
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useModalBehavior({ isOpen, onClose: handleClose });

  // --- auth 만료 처리 ---
  useEffect(() => {
    if (!isOpen) return;
    const handleSessionExpired = () => {
      apiFetch('/robot/stop', { method: 'POST' }).catch(() => {});
      handleClose();
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const controlsDisabled = readOnly || isDisconnected;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <StatusBar
          selectedRobot={selectedRobot}
          floorName={floorName}
          onClose={handleClose}
          controlledBy={readOnly ? controlledBy : undefined}
          isRecording={recording.isRecording}
          recordType={recording.recordType}
          isNavigating={recording.isNavigating}
          onToggleRecording={() => {
            const camId = robotCameras[cam.cameraTabActiveIndex]?.id;
            if (camId) recording.toggleRecording(camId);
          }}
          recordingDisabled={recording.isPending || isDisconnected}
        />

        <div className={styles.mainLayout}>
          <ViewportArea
            isCamLoading={cam.isCamLoading}
            camError={cam.camError}
            cameraStream={cam.cameraStream}
            thermalUrl={cam.thermalUrl}
            retryKey={cam.retryKey}
            cameraTabActiveIndex={cam.cameraTabActiveIndex}
            camera={robotCameras}
            camerasReady={camerasReady}
            onRetryCamera={cam.handleRetryCamera}
            onCameraTab={cam.handleCameraTab}
            onCamImgLoad={cam.handleCamImgLoad}
            onCamImgError={cam.handleCamImgError}
            robotPos={robotPos}
            robotConnected={robotConnected}
            isDisconnected={isDisconnected}
            mapConfig={floorMapConfig}
          />

          <div className={styles.sidebar}>
            <MovementPad
              onCommand={handleMove}
              onStop={handleStop}
              disabled={controlsDisabled || work.isWorking}
              activeKeyRef={activeKeyRef}
            />

            <ControlPanel
              robotType={selectedRobot?.type ?? ''}
              motionState={selectedRobot?.motionState ?? null}
              gait={selectedRobot?.gait ?? null}
              isCharging={selectedRobot?.isCharging ?? false}
              isWorking={work.isWorking}
              isWorkPending={work.isPending}
              loopCount={work.loopCount}
              loopCurrent={work.loopCurrent}
              loopTotal={work.loopTotal}
              loopInfinite={work.loopInfinite}
              isDisconnected={isDisconnected || readOnly}
              onStartWork={work.startWork}
              onStopWork={work.stopWork}
              onLoopCountChange={work.handleLoopCountChange}
              onLoopCountBlur={work.handleLoopCountBlur}
              paths={work.paths}
              selectedPath={work.selectedPath}
              onSelectPath={work.setSelectedPath}
              taskTypeFilter={work.taskTypeFilter}
              onTaskTypeFilterChange={work.setTaskTypeFilter}
              isCreating={work.isCreating}
              createdPoints={work.createdPoints}
              onStartCreating={work.startCreating}
              onSavePoint={work.savePoint}
              onSetPointWait={work.setPointWait}
              onClearPoints={work.clearPoints}
              onFinishCreating={work.finishCreating}
              onCancelCreating={work.cancelCreating}
            />
          </div>
        </div>

        {alertMsg && (
          <AlertDialog message={alertMsg} onClose={() => setAlertMsg(null)} />
        )}

      </div>
    </div>
  );
}
