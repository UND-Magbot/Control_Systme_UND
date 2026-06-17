'use client';

import React, { useRef, useState, useEffect } from 'react';
import { useRemoteCommand } from '../hooks/useRemoteCommand';
import { apiFetch } from '@/app/lib/api';
import InlineConfirm from './InlineConfirm';
import PathStopOptionsModal from '@/app/(pages)/mapManagement/components/tabs/path/PathStopOptionsModal';
import { formatPathOrderWithWaits } from '@/app/lib/pathOrder';
import styles from './ControlPanel.module.css';

type PathOption = {
  id: number;
  wayName: string;
  wayPoints: string;
  waitSeconds?: number[];
  taskType: string;
  floorId: number | null;
};

type WorkProgressPanelProps = {
  isWorking: boolean;
  isPending: boolean;
  loopCount: number | string;
  loopCurrent: number;
  loopTotal: number;
  loopInfinite: boolean;
  disabled?: boolean;
  onStartWork: (loop: number, autoCharge: boolean) => void;
  onStopWork: () => void;
  onLoopCountChange: (value: string) => void;
  onLoopCountBlur: () => void;
  // 경로 선택
  paths: PathOption[];
  selectedPath: PathOption | null;
  onSelectPath: (path: PathOption | null) => void;
  // 작업 유형 필터
  taskTypeFilter: string | null;
  onTaskTypeFilterChange: (value: string | null) => void;
  // 직접 경로 생성
  isCreating: boolean;
  createdPoints: { x: number; y: number; yaw: number; waitSeconds?: number }[];
  onStartCreating: () => void;
  onSavePoint: () => void;
  onSetPointWait: (idx: number, waitSeconds: number) => void;
  onClearPoints: () => void;
  onFinishCreating: (wayName?: string, taskType?: string) => void;
  onCancelCreating: () => void;
};

export default function WorkProgressPanel({
  isWorking,
  isPending,
  loopCount,
  loopCurrent,
  loopTotal,
  loopInfinite,
  disabled = false,
  onStartWork,
  onStopWork,
  onLoopCountChange,
  onLoopCountBlur,
  paths,
  selectedPath,
  onSelectPath,
  taskTypeFilter,
  onTaskTypeFilterChange,
  isCreating,
  createdPoints,
  onStartCreating,
  onSavePoint,
  onSetPointWait,
  onClearPoints,
  onFinishCreating,
  onCancelCreating,
}: WorkProgressPanelProps) {
  const [optionsIdx, setOptionsIdx] = useState<number | null>(null);
  const isDisabled = disabled || isPending;
  // 작업 완료 후 자동 충전 복귀 — 기본 ON. 반복 테스트 등에서 해제 가능.
  const [autoChargeReturn, setAutoChargeReturn] = useState(true);
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
  // 작업 유형 (직접 경로 생성 시) — 기본 task1, 백엔드 기본값과 동일
  const [createTaskType, setCreateTaskType] = useState<string>('task1');

  // 드롭다운
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // 경로 상세 미리보기 — 길면 패널을 밀어내므로 기본 접힘
  const [pathDetailOpen, setPathDetailOpen] = useState(false);

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
          {(loopInfinite || loopTotal > 1) && loopCurrent > 0 && (
            <span className={styles.loopCounter}>
              {loopCurrent} / {loopInfinite ? '∞' : loopTotal} 회
            </span>
          )}
        </div>
        {selectedPath && (
          <div className={styles.wpPathPreview}>
            <span className={styles.wpPathLabel}>{selectedPath.wayName}</span>
            <span className={styles.wpPathDetail}>
              {formatPathOrderWithWaits(selectedPath.wayPoints, selectedPath.waitSeconds, ' → ')}
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
      <div className={`${styles.wpPanel} ${styles.wpPanelCreate}`}>
        <div className={styles.wpCreateHeader}>직접 경로 생성</div>

        <div className={`${styles.wpSection} ${styles.wpCreateListSection}`}>
          <div className={styles.wpCreatePreviewLabel}>현재 경로</div>
          <div className={styles.wpCreatePointList}>
            {createdPoints.length === 0 ? (
              <div className={styles.wpCreatePointEmpty}>저장된 위치가 없습니다</div>
            ) : (
              createdPoints.map((p, i) => (
                <div key={i} className={styles.wpCreatePointChip}>
                  <span className={styles.wpCreatePointIndex}>P{i + 1}</span>
                  <span className={styles.wpCreatePointCoord}>({p.x}, {p.y})</span>
                  {p.waitSeconds && p.waitSeconds > 0 ? (
                    <span className={styles.wpCreatePointWait}>대기 {p.waitSeconds}s</span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.wpCreatePointOptions}
                    onClick={() => setOptionsIdx(i)}
                    title="정지 옵션 설정"
                    aria-label="옵션"
                  >
                    +
                  </button>
                </div>
              ))
            )}
          </div>
          <div className={styles.wpCreatePreviewCount}>
            {createdPoints.length}개 지점
          </div>
        </div>

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

        <div className={styles.wpCreateNameSection}>
          <input
            type="text"
            className={styles.wpNameInput}
            placeholder={autoName ? '자동 생성됩니다' : '경로 이름 입력'}
            value={autoName ? '' : pathName}
            onChange={(e) => setPathName(e.target.value)}
            disabled={autoName}
          />
          <div className={styles.wpAutoNameLine}>
            <label className={styles.wpAutoNameRow}>
              <input
                type="checkbox"
                checked={autoName}
                onChange={(e) => { setAutoName(e.target.checked); if (e.target.checked) setPathName(''); }}
              />
              <span className={styles.wpAutoNameLabel}>이름 자동 생성</span>
            </label>
            <select
              className={styles.wpCreateTaskTypeSelect}
              value={createTaskType}
              onChange={(e) => setCreateTaskType(e.target.value)}
              disabled={isDisabled}
              aria-label="작업 유형"
            >
              <option value="task1">task1</option>
              <option value="task2">task2</option>
              <option value="task3">task3</option>
              <option value="test">test</option>
            </select>
          </div>
        </div>

        <div className={styles.wpCreateFooter}>
          <button
            type="button"
            className={styles.wpCancelBtn}
            onClick={() => { onCancelCreating(); setPathName(''); setAutoName(true); setCreateTaskType('task1'); }}
          >
            취소
          </button>
          <button
            type="button"
            className={styles.wpConfirmBtn}
            onClick={() => {
              onFinishCreating(autoName ? undefined : pathName, createTaskType);
              setPathName('');
              setAutoName(true);
              setCreateTaskType('task1');
            }}
            disabled={createdPoints.length < 2 || (!autoName && !pathName.trim())}
          >
            완료
          </button>
        </div>

        <PathStopOptionsModal
          isOpen={optionsIdx != null}
          placeName={optionsIdx != null ? `P${optionsIdx + 1}` : ''}
          initialWaitSeconds={optionsIdx != null ? createdPoints[optionsIdx]?.waitSeconds ?? 0 : 0}
          onCancel={() => setOptionsIdx(null)}
          onConfirm={(w) => {
            if (optionsIdx != null) onSetPointWait(optionsIdx, w);
            setOptionsIdx(null);
          }}
        />
      </div>
    );
  }

  // 기본 모드: 경로 선택 + 실행
  return (
    <div className={`${styles.wpPanel} ${styles.wpPanelDefault}`}>
      {/* 로봇 위치 재조정 */}
      <div className={styles.wpSection}>
        <div className={styles.controlLabel}>
          로봇 위치{initPoseCoord ? ' (충전소 좌표 기준)' : ''}
        </div>
        <button
          type="button"
          className={styles.actionBtn}
          onClick={handleInitPose}
          disabled={disabled || initState === 'pending'}
        >
          {initState === 'pending' ? '처리 중...' : '위치 재조정'}
        </button>
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

        {/* 작업 유형 필터 */}
        <div className={styles.wpFilterRow}>
          <span className={styles.wpFilterLabel}>작업 유형</span>
          <select
            className={styles.wpFilterSelect}
            value={taskTypeFilter ?? ''}
            onChange={(e) => onTaskTypeFilterChange(e.target.value || null)}
            disabled={isDisabled}
          >
            <option value="">전체</option>
            <option value="task1">task1</option>
            <option value="task2">task2</option>
            <option value="task3">task3</option>
            <option value="test">test</option>
          </select>
        </div>

        <div className={styles.wpDropdown} ref={dropdownRef}>
          <button
            type="button"
            className={styles.wpDropdownBtn}
            onClick={() => setDropdownOpen(!dropdownOpen)}
            disabled={isDisabled}
            title={selectedPath ? `${selectedPath.wayName}\n${formatPathOrderWithWaits(selectedPath.wayPoints, selectedPath.waitSeconds, ' → ')}` : undefined}
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
                const fullPath = formatPathOrderWithWaits(p.wayPoints, p.waitSeconds, ' → ');
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

        {/* 선택된 경로 미리보기 — 기본 접힘(긴 경로가 패널을 밀어내는 것 방지), 토글로 펼침 */}
        {selectedPath && (
          <div className={styles.wpSectionHeader}>
            <button
              type="button"
              className={styles.wpCreateBtnSmall}
              onClick={() => setPathDetailOpen((v) => !v)}
            >
              경로 상세 {pathDetailOpen ? '▲' : '▼'}
            </button>
          </div>
        )}
        {selectedPath && pathDetailOpen && (
          <div className={styles.wpPathPreview}>
            <span className={styles.wpPathDetail}>
              {formatPathOrderWithWaits(selectedPath.wayPoints, selectedPath.waitSeconds, ' → ')}
            </span>
          </div>
        )}
      </div>

      {/* 실행 영역 */}
      <div className={styles.wpSection}>
        {/* 작업 완료 후 자동 충전 복귀 토글 (기본 ON) */}
        <label className={styles.wpAutoNameRow}>
          <input
            type="checkbox"
            checked={autoChargeReturn}
            onChange={(e) => setAutoChargeReturn(e.target.checked)}
            disabled={isDisabled}
          />
          <span className={styles.wpAutoNameLabel}>작업 완료 후 자동 충전 복귀</span>
        </label>

        <div className={styles.workRow}>
          <span className={styles.workRowLabel}>단일 실행</span>
          <button
            type="button"
            className={styles.workStartBtn}
            onClick={() => onStartWork(1, autoChargeReturn)}
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
              onClick={() => onStartWork(Number(loopCount) || 1, autoChargeReturn)}
              disabled={isDisabled || !selectedPath}
            >
              시작
            </button>
          </div>
        </div>

        <div className={styles.workDivider} />

        <div className={styles.workRow}>
          <span className={styles.workRowLabel}>무한 반복</span>
          <div className={styles.loopInputRow}>
            <span
              className={styles.loopInfiniteBadge}
              title="작업 중지를 누를 때까지 계속 반복합니다"
            >
              <span className={styles.loopInfiniteSymbol}>∞</span>
              무제한
            </span>
            <button
              type="button"
              className={`${styles.workStartBtn} ${styles.workStartBtnInfinite}`}
              onClick={() => onStartWork(-1, autoChargeReturn)}
              disabled={isDisabled || !selectedPath}
              title="작업 중지를 누를 때까지 무한 반복합니다"
            >
              <span className={styles.loopInfiniteSymbol}>∞</span>
              시작
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
