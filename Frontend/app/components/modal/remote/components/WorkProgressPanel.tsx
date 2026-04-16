'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useRemoteCommand } from '../hooks/useRemoteCommand';
import { apiFetch } from '@/app/lib/api';
import InlineConfirm from './InlineConfirm';
import styles from './ControlPanel.module.css';

type PathOption = {
  id: number;
  wayName: string;
  wayPoints: string;
};

type WorkProgressPanelProps = {
  isWorking: boolean;
  isPending: boolean;
  loopCount: number | string;
  disabled?: boolean;
  onStartWork: (loop: number) => void;
  onStopWork: () => void;
  onLoopCountChange: (value: string) => void;
  onLoopCountBlur: () => void;
  // 경로 선택
  paths: PathOption[];
  selectedPath: PathOption | null;
  onSelectPath: (path: PathOption | null) => void;
  // 직접 경로 생성
  isCreating: boolean;
  createdPoints: { x: number; y: number; yaw: number }[];
  onStartCreating: () => void;
  onSavePoint: () => void;
  onClearPoints: () => void;
  onFinishCreating: (wayName?: string) => void;
  onCancelCreating: () => void;
};

export default function WorkProgressPanel({
  isWorking,
  isPending,
  loopCount,
  disabled = false,
  onStartWork,
  onStopWork,
  onLoopCountChange,
  onLoopCountBlur,
  paths,
  selectedPath,
  onSelectPath,
  isCreating,
  createdPoints,
  onStartCreating,
  onSavePoint,
  onClearPoints,
  onFinishCreating,
  onCancelCreating,
}: WorkProgressPanelProps) {
  const isDisabled = disabled || isPending;
  const { execute: execInit, state: initState } = useRemoteCommand({ debounceMs: 1000 });

  // 충전소 좌표 (initpose 기준점)
  const [initPoseCoord, setInitPoseCoord] = useState<{ x: number; y: number; yaw: number } | null>(null);
  useEffect(() => {
    apiFetch('/robot/initpose')
      .then((res) => res.json())
      .then((data) => setInitPoseCoord(data))
      .catch(() => {});
  }, []);

  const handleInitPose = () => {
    if (disabled) return;
    execInit('/robot/initpose', '위치 재조정');
  };

  // 경로 이름 입력
  const [pathName, setPathName] = useState('');
  const [autoName, setAutoName] = useState(true);

  // 드롭다운
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 작업 진행 중
  if (isWorking) {
    return (
      <div className={styles.wpPanel}>
        <div className={styles.workStatusBanner}>
          <span className={styles.workingDot} />
          <span>작업 진행 중</span>
        </div>
        {selectedPath && (
          <div className={styles.wpPathPreview}>
            <span className={styles.wpPathLabel}>{selectedPath.wayName}</span>
            <span className={styles.wpPathDetail}>
              {selectedPath.wayPoints.split(' - ').join(' → ')}
            </span>
          </div>
        )}
        <button
          type="button"
          className={styles.stopWorkBtn}
          onClick={onStopWork}
          disabled={isPending}
        >
          {isPending ? '중지 중...' : '작업 중지'}
        </button>
      </div>
    );
  }

  // 직접 경로 생성 모드
  if (isCreating) {
    return (
      <div className={styles.wpPanel}>
        <div className={styles.wpSection}>
          <div className={styles.wpCreateHeader}>직접 경로 생성</div>
        </div>

        <div className={styles.wpSection}>
          <div className={styles.wpCreatePreviewLabel}>현재 경로</div>
          <div className={styles.wpCreatePreviewPath}>
            {createdPoints.length === 0
              ? '저장된 위치가 없습니다'
              : createdPoints.map((p, i) => `P${i + 1}(${p.x}, ${p.y})`).join(' → ')}
          </div>
          <div className={styles.wpCreatePreviewCount}>
            {createdPoints.length}개 지점
          </div>
        </div>

        <div className={styles.wpSection}>
          <div className={styles.wpCreateActions}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onSavePoint}
              disabled={isDisabled}
            >
              위치 저장
            </button>
            <InlineConfirm
              label="위치 초기화"
              confirmLabel="정말 초기화?"
              onConfirm={onClearPoints}
              disabled={isDisabled || createdPoints.length === 0}
              variant="danger"
            />
          </div>
        </div>

        <div className={styles.wpSection}>
          <div className={styles.wpCreatePreviewLabel}>경로 이름</div>
          <input
            type="text"
            className={styles.wpNameInput}
            placeholder={autoName ? '자동 생성됩니다' : '경로 이름 입력'}
            value={autoName ? '' : pathName}
            onChange={(e) => setPathName(e.target.value)}
            disabled={autoName}
          />
          <label className={styles.wpAutoNameRow}>
            <input
              type="checkbox"
              checked={autoName}
              onChange={(e) => { setAutoName(e.target.checked); if (e.target.checked) setPathName(''); }}
            />
            <span className={styles.wpAutoNameLabel}>이름 자동 생성</span>
          </label>
        </div>

        <div className={styles.wpCreateFooter}>
          <button
            type="button"
            className={styles.wpCancelBtn}
            onClick={() => { onCancelCreating(); setPathName(''); setAutoName(true); }}
          >
            취소
          </button>
          <button
            type="button"
            className={styles.wpConfirmBtn}
            onClick={() => { onFinishCreating(autoName ? undefined : pathName); setPathName(''); setAutoName(true); }}
            disabled={createdPoints.length < 2 || (!autoName && !pathName.trim())}
          >
            완료
          </button>
        </div>
      </div>
    );
  }

  // 기본 모드: 경로 선택 + 실행
  return (
    <div className={styles.wpPanel}>
      {/* 로봇 위치 재조정 */}
      <div className={styles.wpSection}>
        <div className={styles.controlLabel}>로봇 위치</div>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={handleInitPose}
          disabled={disabled || initState === 'pending'}
        >
          {initState === 'pending' ? '처리 중...' : '위치 재조정'}
        </button>
        {initPoseCoord && (
          <div className={styles.wpInitPoseCoord}>
            (충전소 좌표: x={initPoseCoord.x}, y={initPoseCoord.y}, yaw={initPoseCoord.yaw})
          </div>
        )}
      </div>

      {/* 경로 선택 드롭다운 */}
      <div className={styles.wpSection}>
        <div className={styles.wpSectionHeader}>
          <div className={styles.controlLabel}>경로 선택</div>
          <button
            type="button"
            className={styles.wpCreateBtnSmall}
            onClick={onStartCreating}
            disabled={isDisabled}
          >
            + 직접 생성
          </button>
        </div>
        <div className={styles.wpDropdown} ref={dropdownRef}>
          <button
            type="button"
            className={styles.wpDropdownBtn}
            onClick={() => setDropdownOpen(!dropdownOpen)}
            disabled={isDisabled}
            title={selectedPath ? `${selectedPath.wayName}\n${selectedPath.wayPoints.split(' - ').join(' → ')}` : undefined}
          >
            <span className={styles.wpDropdownText}>
              {selectedPath ? selectedPath.wayName : '경로를 선택하세요'}
            </span>
            <span className={styles.wpDropdownArrow}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>
          {dropdownOpen && (
            <div className={styles.wpDropdownList}>
              {paths.length === 0 && (
                <div className={styles.wpDropdownEmpty}>등록된 경로가 없습니다</div>
              )}
              {paths.map((p) => {
                const fullPath = p.wayPoints.split(' - ').join(' → ');
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.wpDropdownItem} ${selectedPath?.id === p.id ? styles.wpDropdownItemActive : ''}`}
                    title={`${p.wayName}\n${fullPath}`}
                    onClick={() => {
                      onSelectPath(p);
                      setDropdownOpen(false);
                    }}
                  >
                    <span className={styles.wpDropdownItemName}>{p.wayName}</span>
                    <span className={styles.wpDropdownItemPath}>{fullPath}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 선택된 경로 미리보기 */}
        {selectedPath && (
          <div className={styles.wpPathPreview}>
            <span className={styles.wpPathDetail}>
              {selectedPath.wayPoints.split(' - ').join(' → ')}
            </span>
          </div>
        )}
      </div>

      {/* 실행 영역 */}
      <div className={styles.wpSection}>
        <div className={styles.workRow}>
          <span className={styles.workRowLabel}>단일 실행</span>
          <button
            type="button"
            className={styles.workStartBtn}
            onClick={() => onStartWork(1)}
            disabled={isDisabled || !selectedPath}
          >
            시작
          </button>
        </div>

        <div className={styles.workDivider} />

        <div className={styles.workRow}>
          <span className={styles.workRowLabel}>반복 실행</span>
          <div className={styles.loopInputRow}>
            <input
              type="number"
              min={1}
              max={999}
              value={loopCount}
              onChange={(e) => onLoopCountChange(e.target.value)}
              onBlur={onLoopCountBlur}
              className={styles.loopInput}
              disabled={isDisabled || !selectedPath}
            />
            <span className={styles.loopUnit}>회</span>
            <button
              type="button"
              className={styles.workStartBtn}
              onClick={() => onStartWork(Number(loopCount) || 1)}
              disabled={isDisabled || !selectedPath}
            >
              시작
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
