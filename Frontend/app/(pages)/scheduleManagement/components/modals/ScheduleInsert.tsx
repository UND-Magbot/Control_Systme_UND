'use client';

import styles from '../ScheduleCrud.module.css';
import React, { useState, useEffect, useMemo } from 'react';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useRouter } from 'next/navigation';
import type { RobotRowData } from '@/app/types';
import { apiFetch } from "@/app/lib/api";
import CustomSelect, { type SelectOption } from '@/app/components/select/CustomSelect';
import NumberSpinner from '../widgets/NumberSpinner';
import TimePicker from '../widgets/TimePicker';
import RepeatSettings from '../widgets/RepeatSettings';
import { WORK_TYPES, DOWS, SCHEDULE_MODE_LABELS, INTERVAL_PRESETS, type Dow, type ScheduleMode } from '../../constants';
import { useToast } from '@/app/components/common/Toast';
import { useFormDirty } from '@/app/hooks/useFormDirty';
import {
    validateScheduleForm,
    makeDateTime,
    makeTimeString,
    getByteLength,
    type FieldErrors,
} from '../../utils/validation';
import { formatDate } from '../../utils/datetime';

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
    wayPoints: string;
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

    // 공통 폼 상태
    const [selectedRobot, setSelectedRobot] = useState<SelectOption | null>(null);
    const [taskName, setTaskName] = useState('');
    const [selectedWorkType, setSelectedWorkType] = useState<SelectOption | null>(null);
    const [selectedWorkPath, setSelectedWorkPath] = useState<SelectOption | null>(null);

    // 스케줄 모드
    const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('once');

    // 현재 시각 기준 다음 정시 → 시작 기본값
    const defaultTime = useMemo(() => {
        const n = new Date();
        const startH24 = (n.getHours() + 1) % 24;
        const to12 = (h24: number) => ({
            ampm: h24 < 12 ? '오전' : '오후',
            hour: String(h24 % 12 || 12).padStart(2, '0'),
        });
        return { start: to12(startH24) };
    }, []);

    // once 모드
    const [startDate, setStartDate] = useState<Date>(new Date());
    const [startAmpm, setStartAmpm] = useState<string | null>(defaultTime.start.ampm);
    const [startHour, setStartHour] = useState<string | null>(defaultTime.start.hour);
    const [startMin, setStartMin] = useState<string | null>('00');

    // weekly 모드 (다중 시각)
    type ExecTime = { ampm: string; hour: string; min: string };
    const [execTimes, setExecTimes] = useState<ExecTime[]>([
        { ampm: defaultTime.start.ampm, hour: defaultTime.start.hour, min: '00' },
    ]);
    const [repeatDays, setRepeatDays] = useState<Dow[]>([]);
    const [repeatEveryday, setRepeatEveryday] = useState(false);

    // interval 모드
    const [activeStartAmpm, setActiveStartAmpm] = useState<string | null>('오전');
    const [activeStartHour, setActiveStartHour] = useState<string | null>('09');
    const [activeStartMin, setActiveStartMin] = useState<string | null>('00');
    const [activeEndAmpm, setActiveEndAmpm] = useState<string | null>('오후');
    const [activeEndHour, setActiveEndHour] = useState<string | null>('06');
    const [activeEndMin, setActiveEndMin] = useState<string | null>('00');
    const [intervalMinutes, setIntervalMinutes] = useState<number | null>(10);
    const [intervalRepeatDays, setIntervalRepeatDays] = useState<Dow[]>([]);
    const [intervalEveryday, setIntervalEveryday] = useState(false);

    // weekly + interval 공통
    const [seriesStartDate, setSeriesStartDate] = useState('');
    const [seriesEndType, setSeriesEndType] = useState<'none' | 'date'>('none');
    const [seriesEndDate, setSeriesEndDate] = useState('');

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
        scheduleMode, startDate, startAmpm, startHour, startMin,
        execTimes, repeatDays,
        activeStartAmpm, activeStartHour, activeStartMin,
        activeEndAmpm, activeEndHour, activeEndMin, intervalMinutes,
        intervalRepeatDays, seriesStartDate, seriesEndType, seriesEndDate,
    ]);

    // 모달 오픈 시 폼 초기화
    useEffect(() => {
        if (!isOpen) return;
        setSelectedRobot(null);
        setTaskName('');
        setSelectedWorkType(null);
        setSelectedWorkPath(null);
        setScheduleMode('once');
        setStartDate(today);
        setStartAmpm(defaultTime.start.ampm);
        setStartHour(defaultTime.start.hour);
        setStartMin('00');
        setExecTimes([{ ampm: defaultTime.start.ampm, hour: defaultTime.start.hour, min: '00' }]);
        const todayDow = (['일','월','화','수','목','금','토'] as Dow[])[new Date().getDay()];
        setRepeatDays([todayDow]);
        setRepeatEveryday(false);
        setActiveStartAmpm('오전');
        setActiveStartHour('09');
        setActiveStartMin('00');
        setActiveEndAmpm('오후');
        setActiveEndHour('06');
        setActiveEndMin('00');
        setIntervalMinutes(10);
        setIntervalRepeatDays([todayDow]);
        setIntervalEveryday(false);
        setSeriesStartDate(formatDate(today));
        setSeriesEndType('none');
        setSeriesEndDate(formatDate(today));
        setFieldErrors({});
        setApiError(null);
        setSaving(false);
        setShowDirtyConfirm(false);
    }, [isOpen, today]);

    // 경로 목록 fetch
    useEffect(() => {
        if (!isOpen) return;
        setLoadingPaths(true);

        apiFetch(`/DB/way-names`)
            .then((res) => res.json())
            .then((data) => {
                const list = Array.isArray(data) ? data : (data?.paths ?? []);
                const paths = list.map((row: any) => ({
                    id: row.id,
                    wayName: row.WayName,
                    robotName: row.RobotName,
                    wayPoints: row.WayPoints ?? '',
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

    // 요일 토글 핸들러
    const toggleDay = (day: Dow, days: Dow[], setDays: (d: Dow[]) => void) => {
        setDays(days.includes(day) ? days.filter(d => d !== day) : [...days, day]);
    };

    // 매일 토글
    const handleEveryday = (checked: boolean, setDays: (d: Dow[]) => void, setEveryday: (v: boolean) => void) => {
        setEveryday(checked);
        setDays(checked ? [...DOWS] : []);
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
            scheduleMode,
            startDate,
            startAmpm,
            startHour,
            startMin,
            repeatDays,
            activeStartAmpm,
            activeStartHour,
            activeStartMin,
            activeEndAmpm,
            activeEndHour,
            activeEndMin,
            intervalMinutes,
            intervalRepeatDays,
            seriesStartDate,
            seriesEndType,
            seriesEndDate,
        };

        const errors = validateScheduleForm(formState);
        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            return;
        }

        const selectedRobotData = robots.find((r) => r.id === Number(selectedRobot!.id));
        const wayName = allWorkPaths.find((p) => p.id === Number(selectedWorkPath!.id))?.wayName ?? selectedWorkPath!.label;

        const payload: Record<string, any> = {
            RobotName: selectedRobotData?.no ?? selectedRobot!.label,
            TaskName: taskName,
            TaskType: selectedWorkType!.label,
            WayName: wayName,
            WorkStatus: '대기',
            ScheduleMode: scheduleMode,
        };

        if (scheduleMode === 'once') {
            payload.StartTime = makeDateTime(startDate, startAmpm!, startHour!, startMin!);
        } else if (scheduleMode === 'weekly') {
            payload.ExecutionTime = execTimes.map((t) => makeTimeString(t.ampm, t.hour, t.min)).join(',');
            payload.RepeatDays = repeatDays.join(',');
            payload.SeriesStartDate = seriesStartDate;
            payload.SeriesEndDate = seriesEndType === 'date' ? seriesEndDate : null;
        } else if (scheduleMode === 'interval') {
            payload.ActiveStartTime = makeTimeString(activeStartAmpm!, activeStartHour!, activeStartMin!);
            payload.ActiveEndTime = makeTimeString(activeEndAmpm!, activeEndHour!, activeEndMin!);
            payload.IntervalMinutes = intervalMinutes;
            payload.RepeatDays = intervalRepeatDays.length ? intervalRepeatDays.join(',') : null;
            payload.SeriesStartDate = seriesStartDate;
            payload.SeriesEndDate = seriesEndType === 'date' ? seriesEndDate : null;
        }

        setSaving(true);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);

            const res = await apiFetch(`/DB/schedule`, {
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
                    <div className={styles.detailHeader}>
                        <div className={styles.detailHeaderLeft}>
                            <img src="/icon/robot_schedule_w.png" alt="" className={styles.detailHeaderIcon} />
                            <h2>작업 등록</h2>
                        </div>
                        <button className={styles.CloseBtn} onClick={handleClose}>✕</button>
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
                            {fieldErrors.robot && <span className={styles.fieldError}>{fieldErrors.robot}</span>}
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
                            {fieldErrors.workType && <span className={styles.fieldError}>{fieldErrors.workType}</span>}
                        </div>

                        {/* === 스케줄 모드 선택 === */}
                        <div className={styles.sectionDivider}>
                            <div className={styles.itemBoxWrap}>
                                <div className={styles.itemBox}>
                                    <div>실행 방식</div>
                                    <div className={styles.modeRadioGroup}>
                                        {(['once', 'weekly', 'interval'] as ScheduleMode[]).map((mode) => (
                                            <label key={mode} className={styles.modeRadioLabel}>
                                                <input
                                                    type="radio"
                                                    name="scheduleMode"
                                                    checked={scheduleMode === mode}
                                                    onChange={() => setScheduleMode(mode)}
                                                />
                                                <span>{SCHEDULE_MODE_LABELS[mode]}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* === 단일 실행 (once) === */}
                            {scheduleMode === 'once' && (
                                <TimePicker
                                    label="실행 일시"
                                    date={startDate}
                                    onDateChange={setStartDate}
                                    ampm={startAmpm}
                                    onAmpmChange={setStartAmpm}
                                    hour={startHour}
                                    onHourChange={setStartHour}
                                    minute={startMin}
                                    onMinuteChange={setStartMin}
                                    formatDate={formatDate}
                                    minDate={formatDate(today)}
                                    errors={{
                                        ampm: fieldErrors.startAmpm,
                                        hour: fieldErrors.startHour,
                                        minute: fieldErrors.startMin,
                                        dateTime: fieldErrors.pastDate,
                                    }}
                                />
                            )}

                            {/* === 요일 반복 (weekly) === */}
                            {scheduleMode === 'weekly' && (
                                <>
                                    {/* 다중 실행 시각 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>실행 시각</div>
                                            <div className={styles.execTimeSection}>
                                                <div className={styles.execTimeList}>
                                                    {execTimes.map((et, idx) => (
                                                        <div key={idx} className={styles.execTimeRow}>
                                                            <TimePicker
                                                                label={`시각 ${idx + 1}`}
                                                                date={startDate}
                                                                onDateChange={() => {}}
                                                                ampm={et.ampm}
                                                                onAmpmChange={(v) => setExecTimes((prev) => prev.map((t, i) => i === idx ? { ...t, ampm: v } : t))}
                                                                hour={et.hour}
                                                                onHourChange={(v) => setExecTimes((prev) => prev.map((t, i) => i === idx ? { ...t, hour: v } : t))}
                                                                minute={et.min}
                                                                onMinuteChange={(v) => setExecTimes((prev) => prev.map((t, i) => i === idx ? { ...t, min: v } : t))}
                                                                formatDate={formatDate}
                                                                hideDate
                                                                inline
                                                            />
                                                            {execTimes.length > 1 && (
                                                                <button type="button" className={styles.execTimeRemoveBtn}
                                                                    onClick={() => setExecTimes((prev) => prev.filter((_, i) => i !== idx))}
                                                                >✕</button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                                <button type="button" className={styles.execTimeAddBtn}
                                                    onClick={() => setExecTimes((prev) => [...prev, { ampm: defaultTime.start.ampm, hour: defaultTime.start.hour, min: '00' }])}
                                                >+ 시각 추가</button>
                                            </div>
                                        </div>
                                    </div>
                                    {/* 요일 선택 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>반복 요일</div>
                                            <div className={styles.repeatDayWrap}>
                                                <div className={styles.repeatDayBtns}>
                                                    {DOWS.map((d) => (
                                                        <button
                                                            key={d}
                                                            type="button"
                                                            className={`${styles.repeatDayBtn} ${repeatDays.includes(d) ? styles.repeatDayBtnActive : ''}`}
                                                            onClick={() => toggleDay(d, repeatDays, setRepeatDays)}
                                                        >
                                                            {d}
                                                        </button>
                                                    ))}
                                                </div>
                                                <label className={styles.repeatEveryday}>
                                                    <input
                                                        type="checkbox"
                                                        checked={repeatEveryday}
                                                        onChange={(e) => handleEveryday(e.target.checked, setRepeatDays, setRepeatEveryday)}
                                                    />
                                                    매일
                                                </label>
                                            </div>
                                        </div>
                                        {fieldErrors.repeatDays && <span className={styles.fieldError}>{fieldErrors.repeatDays}</span>}
                                    </div>
                                    {/* 유효 기간 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>유효 기간</div>
                                            <div className={styles.seriesDateWrap}>
                                                <div className={styles.seriesDateRow}>
                                                    <span className={styles.seriesDateLabel}>시작일</span>
                                                    <input
                                                        type="date"
                                                        value={seriesStartDate}
                                                        onChange={(e) => setSeriesStartDate(e.target.value)}
                                                        min={formatDate(today)}
                                                        className={styles.seriesDateInput}
                                                    />
                                                </div>
                                                <div className={styles.seriesDateRow}>
                                                    <span className={styles.seriesDateLabel}>종료</span>
                                                    <label className={styles.seriesEndRadio}>
                                                        <input type="radio" checked={seriesEndType === 'none'} onChange={() => setSeriesEndType('none')} />
                                                        무기한
                                                    </label>
                                                    <label className={styles.seriesEndRadio}>
                                                        <input type="radio" checked={seriesEndType === 'date'} onChange={() => setSeriesEndType('date')} />
                                                        날짜 지정
                                                    </label>
                                                </div>
                                                {seriesEndType === 'date' && (
                                                    <div className={styles.seriesDateRow}>
                                                        <span className={styles.seriesDateLabel}>종료일</span>
                                                        <input
                                                            type="date"
                                                            value={seriesEndDate}
                                                            onChange={(e) => setSeriesEndDate(e.target.value)}
                                                            min={seriesStartDate || formatDate(today)}
                                                            className={styles.seriesDateInput}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {fieldErrors.seriesEndDate && <span className={styles.fieldError}>{fieldErrors.seriesEndDate}</span>}
                                    </div>
                                </>
                            )}

                            {/* === 주기 반복 (interval) === */}
                            {scheduleMode === 'interval' && (
                                <>
                                    <TimePicker
                                        label="활동 시작"
                                        date={startDate}
                                        onDateChange={() => {}}
                                        ampm={activeStartAmpm}
                                        onAmpmChange={setActiveStartAmpm}
                                        hour={activeStartHour}
                                        onHourChange={setActiveStartHour}
                                        minute={activeStartMin}
                                        onMinuteChange={setActiveStartMin}
                                        formatDate={formatDate}
                                        hideDate
                                        errors={{
                                            ampm: fieldErrors.activeStartAmpm,
                                            hour: fieldErrors.activeStartHour,
                                            minute: fieldErrors.activeStartMin,
                                        }}
                                    />
                                    <TimePicker
                                        label="활동 종료"
                                        date={startDate}
                                        onDateChange={() => {}}
                                        ampm={activeEndAmpm}
                                        onAmpmChange={setActiveEndAmpm}
                                        hour={activeEndHour}
                                        onHourChange={setActiveEndHour}
                                        minute={activeEndMin}
                                        onMinuteChange={setActiveEndMin}
                                        formatDate={formatDate}
                                        hideDate
                                        errors={{
                                            ampm: fieldErrors.activeEndAmpm,
                                            hour: fieldErrors.activeEndHour,
                                            minute: fieldErrors.activeEndMin,
                                        }}
                                    />
                                    {/* 반복 간격 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>반복 간격</div>
                                            <div className={styles.intervalInputWrap}>
                                                <NumberSpinner
                                                    value={intervalMinutes}
                                                    onChange={setIntervalMinutes}
                                                    min={1}
                                                    max={1440}
                                                    placeholder="10"
                                                    error={!!fieldErrors.intervalMinutes}
                                                    pad={1}
                                                />
                                                <span className={styles.intervalUnit}>분마다</span>
                                                <div className={styles.intervalPresets}>
                                                    {INTERVAL_PRESETS.map((p) => (
                                                        <button
                                                            key={p}
                                                            type="button"
                                                            className={`${styles.intervalPresetBtn} ${intervalMinutes === p ? styles.intervalPresetActive : ''}`}
                                                            onClick={() => setIntervalMinutes(p)}
                                                        >
                                                            {p}분
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                        {fieldErrors.intervalMinutes && <span className={styles.fieldError}>{fieldErrors.intervalMinutes}</span>}
                                    </div>
                                    {/* 요일 선택 (선택사항) */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>반복 요일</div>
                                            <div className={styles.repeatDayWrap}>
                                                <div className={styles.repeatDayBtns}>
                                                    {DOWS.map((d) => (
                                                        <button
                                                            key={d}
                                                            type="button"
                                                            className={`${styles.repeatDayBtn} ${intervalRepeatDays.includes(d) ? styles.repeatDayBtnActive : ''}`}
                                                            onClick={() => toggleDay(d, intervalRepeatDays, setIntervalRepeatDays)}
                                                        >
                                                            {d}
                                                        </button>
                                                    ))}
                                                </div>
                                                <label className={styles.repeatEveryday}>
                                                    <input
                                                        type="checkbox"
                                                        checked={intervalEveryday}
                                                        onChange={(e) => handleEveryday(e.target.checked, setIntervalRepeatDays, setIntervalEveryday)}
                                                    />
                                                    매일
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                    {/* 유효 기간 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>유효 기간</div>
                                            <div className={styles.seriesDateWrap}>
                                                <div className={styles.seriesDateRow}>
                                                    <span className={styles.seriesDateLabel}>시작일</span>
                                                    <input
                                                        type="date"
                                                        value={seriesStartDate}
                                                        onChange={(e) => setSeriesStartDate(e.target.value)}
                                                        min={formatDate(today)}
                                                        className={styles.seriesDateInput}
                                                    />
                                                </div>
                                                <div className={styles.seriesDateRow}>
                                                    <span className={styles.seriesDateLabel}>종료</span>
                                                    <label className={styles.seriesEndRadio}>
                                                        <input type="radio" checked={seriesEndType === 'none'} onChange={() => setSeriesEndType('none')} />
                                                        무기한
                                                    </label>
                                                    <label className={styles.seriesEndRadio}>
                                                        <input type="radio" checked={seriesEndType === 'date'} onChange={() => setSeriesEndType('date')} />
                                                        날짜 지정
                                                    </label>
                                                </div>
                                                {seriesEndType === 'date' && (
                                                    <div className={styles.seriesDateRow}>
                                                        <span className={styles.seriesDateLabel}>종료일</span>
                                                        <input
                                                            type="date"
                                                            value={seriesEndDate}
                                                            onChange={(e) => setSeriesEndDate(e.target.value)}
                                                            min={seriesStartDate || formatDate(today)}
                                                            className={styles.seriesDateInput}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {fieldErrors.seriesEndDate && <span className={styles.fieldError}>{fieldErrors.seriesEndDate}</span>}
                                    </div>
                                </>
                            )}
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
                                {fieldErrors.workPath && <span className={styles.fieldError}>{fieldErrors.workPath}</span>}
                                {selectedWorkPath && (() => {
                                    const matched = allWorkPaths.find((p) => p.id === Number(selectedWorkPath.id));
                                    return matched?.wayPoints ? (
                                        <div className={styles.itemBoxWrap}>
                                            <div className={styles.itemBox}>
                                                <div>경로순서</div>
                                                <div className={styles.pathOrderText}>{matched.wayPoints}</div>
                                            </div>
                                        </div>
                                    ) : null;
                                })()}
                            </div>
                            <div className={styles.pathBoxFlex}>
                                <div></div>
                                <button
                                    className={styles.itemBoxBtn}
                                    type="button"
                                    onClick={() => router.push('/mapManagement?tab=path')}
                                >
                                    경로 관리 탭으로 이동 →
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 하단 버튼 */}
                    <div className={styles.btnTotal}>
                        <div className={styles.btnLeftBox}>
                            <button
                                type="button"
                                className={`${styles.btnItemCommon} ${styles.btnBgRed}`}
                                onClick={saving ? undefined : handleClose}
                                disabled={saving}
                            >
                                <img src="/icon/close_btn.png" alt="cancel" />
                                <span>취소</span>
                            </button>
                            <button
                                type="button"
                                className={`${styles.btnItemCommon} ${styles.btnBgBlue} ${saving ? styles.btnDisabled : ''}`}
                                onClick={saving ? undefined : handleSave}
                                disabled={saving}
                            >
                                <img src="/icon/check.png" alt="save" />
                                <span>{saving ? '저장 중...' : '저장'}</span>
                            </button>
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
