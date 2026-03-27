'use client';

import styles from './ScheduleCrud.module.css';
import React, { useState, useEffect, useMemo } from 'react';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useRouter } from 'next/navigation';
import type { RobotRowData } from '@/app/type';
import { API_BASE } from "@/app/config";
import CustomSelect, { type SelectOption } from '@/app/components/select/CustomSelect';
import TimePicker from './TimePicker';
import RepeatSettings from './RepeatSettings';
import { WORK_TYPES, type Dow } from '../constants';
import { useToast } from '@/app/components/common/Toast';
import { useFormDirty } from '@/app/hooks/useFormDirty';
import {
    validateScheduleForm,
    makeDateTime,
    getByteLength,
    type FieldErrors,
} from '../utils/validation';

type InsertModalProps = {
    isOpen: boolean;
    onClose: () => void;
    robots: RobotRowData[];
    onScheduleChanged?: () => void;
};

type WorkPathOption = {
    id: number;
    wayName: string;
    robotName: string;
};

const WORK_TYPE_OPTIONS: SelectOption[] = WORK_TYPES.map((t) => ({
    id: t.id,
    label: t.label,
}));

export default function InsertModal({
    isOpen,
    onClose,
    robots,
    onScheduleChanged,
}: InsertModalProps) {
    const router = useRouter();
    const { showToast } = useToast();

    // 폼 상태
    const [selectedRobot, setSelectedRobot] = useState<SelectOption | null>(null);
    const [taskName, setTaskName] = useState('');
    const [selectedWorkType, setSelectedWorkType] = useState<SelectOption | null>(null);
    const [selectedWorkPath, setSelectedWorkPath] = useState<SelectOption | null>(null);

    // 현재 시각 기준 다음 정시 → 시작, +1시간 → 종료
    const defaultTime = useMemo(() => {
      const n = new Date();
      const startH24 = (n.getHours() + 1) % 24;
      const endH24 = (startH24 + 1) % 24;
      const to12 = (h24: number) => ({
        ampm: h24 < 12 ? '오전' : '오후',
        hour: String(h24 % 12 || 12).padStart(2, '0'),
      });
      return { start: to12(startH24), end: to12(endH24) };
    }, []);

    const [startDate, setStartDate] = useState<Date>(new Date());
    const [endDate, setEndDate] = useState<Date>(new Date());
    const [startAmpm, setStartAmpm] = useState<string | null>(defaultTime.start.ampm);
    const [startHour, setStartHour] = useState<string | null>(defaultTime.start.hour);
    const [startMin, setStartMin] = useState<string | null>('00');
    const [endAmpm, setEndAmpm] = useState<string | null>(defaultTime.end.ampm);
    const [endHour, setEndHour] = useState<string | null>(defaultTime.end.hour);
    const [endMin, setEndMin] = useState<string | null>('00');

    const [repeatEnabled, setRepeatEnabled] = useState(false);
    const [repeatDays, setRepeatDays] = useState<Dow[]>([]);
    const [repeatEveryday, setRepeatEveryday] = useState(false);
    const [repeatEndType, setRepeatEndType] = useState<'none' | 'date'>('none');
    const [repeatEndDate, setRepeatEndDate] = useState('');

    // UI 상태
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [apiError, setApiError] = useState<string | null>(null);
    const [showDirtyConfirm, setShowDirtyConfirm] = useState(false);

    // 경로 데이터
    const [allWorkPaths, setAllWorkPaths] = useState<WorkPathOption[]>([]);
    const [loadingPaths, setLoadingPaths] = useState(false);

    const today = useMemo(() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    const formatDate = (date: Date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    // 로봇 옵션
    const robotOptions: SelectOption[] = useMemo(
        () => robots.map((r) => ({ id: r.id, label: r.no })),
        [robots]
    );

    // 로봇별 경로 필터링
    const filteredPathOptions: SelectOption[] = useMemo(() => {
        if (!selectedRobot) return allWorkPaths.map((p) => ({ id: p.id, label: p.wayName }));
        return allWorkPaths
            .filter((p) => p.robotName === selectedRobot.label)
            .map((p) => ({ id: p.id, label: p.wayName }));
    }, [allWorkPaths, selectedRobot]);

    // 바이트 카운터
    const taskNameBytes = useMemo(() => getByteLength(taskName), [taskName]);

    // 미저장 변경사항 추적
    const { isDirty } = useFormDirty([
        selectedRobot, taskName, selectedWorkType, selectedWorkPath,
        startDate, endDate, startAmpm, startHour, startMin,
        endAmpm, endHour, endMin, repeatEnabled, repeatDays,
        repeatEndType, repeatEndDate,
    ]);

    // 모달 오픈 시 폼 초기화
    useEffect(() => {
        if (!isOpen) return;
        setSelectedRobot(null);
        setTaskName('');
        setSelectedWorkType(null);
        setSelectedWorkPath(null);
        setStartDate(today);
        setEndDate(today);
        setStartAmpm(defaultTime.start.ampm);
        setStartHour(defaultTime.start.hour);
        setStartMin('00');
        setEndAmpm(defaultTime.end.ampm);
        setEndHour(defaultTime.end.hour);
        setEndMin('00');
        setRepeatEnabled(false);
        setRepeatDays([]);
        setRepeatEveryday(false);
        setRepeatEndType('none');
        setRepeatEndDate(formatDate(today));
        setFieldErrors({});
        setApiError(null);
        setSaving(false);
        setShowDirtyConfirm(false);
    }, [isOpen, today]);

    // 경로 목록 fetch
    useEffect(() => {
        if (!isOpen) return;
        setLoadingPaths(true);

        fetch(`${API_BASE}/DB/way-names`)
            .then((res) => res.json())
            .then((data) => {
                const list = Array.isArray(data) ? data : (data?.paths ?? []);
                const paths = list.map((row: any) => ({
                    id: row.id,
                    wayName: row.WayName,
                    robotName: row.RobotName,
                }));
                setAllWorkPaths(paths);
            })
            .catch((e) => {
                console.error('경로 목록 조회 실패', e);
                setAllWorkPaths([]);
            })
            .finally(() => setLoadingPaths(false));
    }, [isOpen]);

    // 로봇 변경 시 경로 초기화
    useEffect(() => {
        if (selectedWorkPath && selectedRobot) {
            const match = allWorkPaths.find(
                (p) => p.id === Number(selectedWorkPath.id) && p.robotName === selectedRobot.label
            );
            if (!match) setSelectedWorkPath(null);
        }
    }, [selectedRobot, allWorkPaths]);

    // 시작일 변경 시 종료일을 같은 날로 동기화 (당일 일정만 허용)
    const handleStartDateChange = (date: Date) => {
        setStartDate(date);
        setEndDate(date); // 종료일은 항상 시작일과 동일
        const repeatEnd = new Date(repeatEndDate);
        if (repeatEnd < date) setRepeatEndDate(formatDate(date));
    };

    // 종료일은 시작일과 동일해야 하므로 변경 시 시작일로 강제
    const handleEndDateChange = (_date: Date) => {
        // 당일 일정만 허용: 종료일은 시작일과 동일하게 유지
        setEndDate(startDate);
    };

    // 반복 설정 핸들러
    const handleRepeatEnabled = (enabled: boolean) => {
        setRepeatEnabled(enabled);
        if (!enabled) {
            setRepeatDays([]);
            setRepeatEveryday(false);
            setRepeatEndType('none');
            setRepeatEndDate(formatDate(today));
        }
    };

    // 닫기 핸들러 (미저장 경고)
    const handleClose = () => {
        if (isDirty && !saving) {
            setShowDirtyConfirm(true);
        } else {
            onClose();
        }
    };

    useModalBehavior({ isOpen, onClose: handleClose, disabled: saving });

    // 저장
    const handleSave = async () => {
        setFieldErrors({});
        setApiError(null);

        const formState = {
            selectedRobot,
            taskName,
            selectedWorkType,
            selectedWorkPath,
            startDate,
            endDate,
            startAmpm,
            startHour,
            startMin,
            endAmpm,
            endHour,
            endMin,
            repeatEnabled,
            repeatDays,
            repeatEndType,
            repeatEndDate,
        };

        const errors = validateScheduleForm(formState);
        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            return;
        }

        const startDateTime = makeDateTime(startDate, startAmpm!, startHour!, startMin!);
        const endDateTime = makeDateTime(endDate, endAmpm!, endHour!, endMin!);

        const selectedRobotData = robots.find((r) => r.id === Number(selectedRobot!.id));

        const payload = {
            RobotName: selectedRobotData?.no ?? selectedRobot!.label,
            TaskName: taskName,
            TaskType: selectedWorkType!.label,
            WayName: allWorkPaths.find((p) => p.id === Number(selectedWorkPath!.id))?.wayName ?? selectedWorkPath!.label,
            WorkStatus: '대기',
            StartTime: startDateTime,
            EndTime: endDateTime,
            Repeat: repeatEnabled,
            RepeatDays: repeatDays.length ? repeatDays.join(',') : null,
            RepeatEndDate: repeatEndType === 'date' ? repeatEndDate : null,
        };

        setSaving(true);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(`${API_BASE}/DB/schedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                const body = await res.json().catch(() => null);
                setApiError(body?.detail || body?.message || '스케줄 저장에 실패했습니다.');
                return;
            }

            showToast('작업일정이 등록되었습니다.', 'success');
            onScheduleChanged?.();
            onClose();
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                setApiError('서버 응답 시간이 초과되었습니다. 다시 시도해주세요.');
            } else {
                console.error('스케줄 저장 실패', e);
                setApiError('네트워크 오류가 발생했습니다.');
            }
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className={styles.scheduleModalOverlay} onClick={handleClose}>
                <div className={styles.scheduleModalContainer} onClick={(e) => e.stopPropagation()}>
                    <button className={styles.CloseBtn} onClick={handleClose}>✕</button>
                    <div className={styles.Title}>
                        <img src="/icon/robot_schedule_w.png" alt="Robot Registration" />
                        <h2>작업 등록</h2>
                    </div>

                    <div className={styles.itemContainer}>
                        {/* === 기본 정보 섹션 === */}
                        <div className={styles.itemBoxWrap}>
                            <div className={styles.itemBox}>
                                <div>로봇명</div>
                                <CustomSelect
                                    options={robotOptions}
                                    value={selectedRobot}
                                    onChange={setSelectedRobot}
                                    placeholder="로봇명을 선택하세요"
                                    error={!!fieldErrors.robot}
                                    emptyMessage="등록된 로봇이 없습니다"
                                />
                            </div>
                            {fieldErrors.robot && <span className={styles.fieldError} >{fieldErrors.robot}</span>}
                        </div>

                        <div className={styles.itemBoxWrap}>
                            <div className={styles.itemBox}>
                                <div>작업명</div>
                                <div className={styles.inputWithByte}>
                                    <input
                                        type="text"
                                        placeholder="25자(50byte) 이내로 작성하세요"
                                        value={taskName}
                                        onChange={(e) => setTaskName(e.target.value)}
                                        maxLength={25}
                                        className={fieldErrors.taskName ? styles.inputError : ''}
                                    />
                                    <span className={`${styles.byteInline} ${taskNameBytes > 40 ? styles.byteCounterWarn : ''}`}>
                                        {taskNameBytes}/50
                                    </span>
                                    {fieldErrors.taskName && <span className={styles.fieldError}>{fieldErrors.taskName}</span>}
                                </div>
                            </div>
                        </div>

                        <div className={styles.itemBoxWrap}>
                            <div className={styles.itemBox}>
                                <div>작업유형</div>
                                <CustomSelect
                                    options={WORK_TYPE_OPTIONS}
                                    value={selectedWorkType}
                                    onChange={setSelectedWorkType}
                                    placeholder="작업유형을 선택하세요"
                                    error={!!fieldErrors.workType}
                                />
                            </div>
                            {fieldErrors.workType && <span className={styles.fieldError} >{fieldErrors.workType}</span>}
                        </div>

                        {/* === 작업일시 섹션 === */}
                        <div className={styles.sectionDivider}>
                            <TimePicker
                                label="시작"
                                date={startDate}
                                onDateChange={handleStartDateChange}
                                ampm={startAmpm}
                                onAmpmChange={setStartAmpm}
                                hour={startHour}
                                onHourChange={setStartHour}
                                minute={startMin}
                                onMinuteChange={setStartMin}
                                formatDate={formatDate}
                                minDate={formatDate(today)}
                                maxDate={formatDate(today)}
                                errors={{
                                    ampm: fieldErrors.startAmpm,
                                    hour: fieldErrors.startHour,
                                    minute: fieldErrors.startMin,
                                }}
                            />
                            <TimePicker
                                label="종료"
                                date={endDate}
                                onDateChange={handleEndDateChange}
                                ampm={endAmpm}
                                onAmpmChange={setEndAmpm}
                                hour={endHour}
                                onHourChange={setEndHour}
                                minute={endMin}
                                onMinuteChange={setEndMin}
                                formatDate={formatDate}
                                minDate={formatDate(startDate)}
                                maxDate={formatDate(startDate)}
                                errors={{
                                    ampm: fieldErrors.endAmpm,
                                    hour: fieldErrors.endHour,
                                    minute: fieldErrors.endMin,
                                    dateTime: fieldErrors.dateTime || fieldErrors.pastDate,
                                }}
                            />
                        </div>

                        {/* === 반복설정 섹션 === */}
                        <div className={styles.sectionDivider}>
                            <RepeatSettings
                                enabled={repeatEnabled}
                                onEnabledChange={handleRepeatEnabled}
                                days={repeatDays}
                                onDaysChange={setRepeatDays}
                                everyday={repeatEveryday}
                                onEverydayChange={setRepeatEveryday}
                                endType={repeatEndType}
                                onEndTypeChange={setRepeatEndType}
                                endDate={repeatEndDate}
                                onEndDateChange={setRepeatEndDate}
                                formatDate={formatDate}
                                errors={{
                                    repeatDays: fieldErrors.repeatDays,
                                    repeatEndDate: fieldErrors.repeatEndDate,
                                }}
                            />
                        </div>

                        {/* === 작업경로 섹션 === */}
                        <div className={`${styles.sectionDivider}`}>
                            <div className={styles.itemBoxWrap}>
                                <div className={`${styles.itemBox} ${styles.pathBox}`}>
                                    <div>작업경로</div>
                                    {loadingPaths ? (
                                        <div className={styles.loadingText}>로딩 중...</div>
                                    ) : (
                                        <CustomSelect
                                            options={filteredPathOptions}
                                            value={selectedWorkPath}
                                            onChange={setSelectedWorkPath}
                                            placeholder="경로명을 선택하세요"
                                            error={!!fieldErrors.workPath}
                                            overlay
                                            emptyMessage={
                                                selectedRobot
                                                    ? '선택된 로봇의 경로가 없습니다'
                                                    : '경로가 없습니다'
                                            }
                                        />
                                    )}
                                </div>
                                {fieldErrors.workPath && <span className={styles.fieldError} >{fieldErrors.workPath}</span>}
                            </div>
                            <div className={styles.pathBoxFlex}>
                                <div></div>
                                <button
                                    className={styles.itemBoxBtn}
                                    type="button"
                                    onClick={() => router.push('/robots?tab=path')}
                                >
                                    경로 관리 →
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* API / 네트워크 에러 확인창 */}


                    {/* 하단 버튼 */}
                    <div className={styles.insertBtnTotal}>
                        <div
                            className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`}
                            onClick={saving ? undefined : handleClose}
                            style={saving ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
                        >
                            <img src="/icon/close_btn.png" alt="cancel" />
                            <div>취소</div>
                        </div>
                        <div
                            className={`${styles.insertConfrimBtn} ${styles.btnBgBlue} ${saving ? styles.btnDisabled : ''}`}
                            onClick={saving ? undefined : handleSave}
                            style={saving ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
                        >
                            <img src="/icon/check.png" alt="save" />
                            <div>{saving ? '저장 중...' : '저장'}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 미저장 변경사항 확인 모달 */}
            {showDirtyConfirm && (
                <div className={styles.confirmOverlay} onClick={() => setShowDirtyConfirm(false)}>
                    <div className={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
                        <p>입력 중인 내용이 있습니다.<br />닫으시겠습니까?</p>
                        <div className={styles.confirmBtnGroup}>
                            <button
                                className={styles.confirmBtnStay}
                                onClick={() => setShowDirtyConfirm(false)}
                            >
                                계속 작성
                            </button>
                            <button
                                className={styles.confirmBtnLeave}
                                onClick={() => {
                                    setShowDirtyConfirm(false);
                                    onClose();
                                }}
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* API 에러 확인창 */}
            {apiError && (
                <div className={styles.confirmOverlay} onClick={() => setApiError(null)}>
                    <div className={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
                        <p>{apiError}</p>
                        <div className={styles.confirmBtnGroup}>
                            <button className={styles.confirmBtnStay} onClick={() => setApiError(null)}>
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
