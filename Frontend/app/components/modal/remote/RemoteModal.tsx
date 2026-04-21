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
import MovementPad from './components/MovementPad';
import ControlPanel from './components/ControlPanel';
import AlertDialog from './components/AlertDialog';
import BatteryPathModal from '@/app/components/modal/BatteryChargeModal';

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

  // --- 긴급 정지 확인 모달 ---
  const [emergencyConfirmOpen, setEmergencyConfirmOpen] = useState(false);
  const handleEmergencyStop = useCallback(() => setEmergencyConfirmOpen(true), []);
  const handleEmergencyConfirm = useCallback(() => {
    apiFetch('/nav/stopmove', { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        showAlert(data?.was_active ? '작업이 중지되었습니다.' : '진행 중인 작업이 없습니다.');
      })
      .catch((err) => console.error('긴급 정지 실패', err));
    setEmergencyConfirmOpen(false);
  }, [showAlert]);

  // --- 커스텀 훅 (카메라 준비 후에만 활성화) ---
  const cam = useCameraStream({ isOpen: isOpen && camerasReady, camera: robotCameras, initialCam, initialCamIndex });
  const work = useWorkAutomation(isOpen, { onAlert: showAlert });
  const { position: robotPos, isReady: robotConnected, hasError: positionError } = useRobotPosition(isOpen);
  const moveCmd = useRemoteCommand({ debounceMs: 100, onError: showAlert });
  const recording = useRecording(isOpen, selectedRobot?.id);

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
            retryKey={cam.retryKey}
            cameraTabActiveIndex={cam.cameraTabActiveIndex}
            camera={robotCameras}
            onRetryCamera={cam.handleRetryCamera}
            onCameraTab={cam.handleCameraTab}
            onCamImgLoad={cam.handleCamImgLoad}
            onCamImgError={cam.handleCamImgError}
            robotPos={robotPos}
            robotConnected={robotConnected}
            isDisconnected={isDisconnected}
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
              isCharging={selectedRobot?.isCharging ?? false}
              onEmergencyStop={handleEmergencyStop}
              emergencyDisabled={isDisconnected || !(work.isWorking || (selectedRobot?.isNavigating ?? false))}
              isWorking={work.isWorking}
              isWorkPending={work.isPending}
              loopCount={work.loopCount}
              loopCurrent={work.loopCurrent}
              loopTotal={work.loopTotal}
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
              onClearPoints={work.clearPoints}
              onFinishCreating={work.finishCreating}
              onCancelCreating={work.cancelCreating}
            />
          </div>
        </div>

        {alertMsg && (
          <AlertDialog message={alertMsg} onClose={() => setAlertMsg(null)} />
        )}

        {emergencyConfirmOpen && (
          <BatteryPathModal
            isOpen={emergencyConfirmOpen}
            message="긴급 정지하시겠습니까?"
            onConfirm={handleEmergencyConfirm}
            onCancel={() => setEmergencyConfirmOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
