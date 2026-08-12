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
import DateField from '../widgets/DateField';
import CustomCheckbox from '../widgets/CustomCheckbox';
import { WORK_TYPES, WORK_TYPE_ALL, resolveTaskTypeLabel, DOWS, SCHEDULE_MODE_LABELS, INTERVAL_PRESETS, STANDBY_TRIGGERS, type Dow, type ScheduleMode } from '../../constants';
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
    onScheduleChanged?: () => Promise<void> | void;
};

type StopActionPreview = {
    announceText?: string | null;
    confirm?: "none" | "button" | "voice" | "gesture";
} | null;

/** 상시 대기 등록 가능 여부 — 서버(standby_capability)와 같은 판정을 화면에서도 쓴다 */
type StandbyCapability = {
    allowed: boolean;
    reason: string | null;
    hasVoice: boolean;
    hasMic: boolean;
    hasSpeaker: boolean;
    destinationCount: number;
    allowedTriggers: string[];
};

type WorkPathOption = {
    id: number;
    wayName: string;
    robotName: string;
    wayPoints: string;
    taskType: string;
    floorId: number | null;
    stopActions?: StopActionPreview[]; // 경유지 도착 안내 미리보기
};

const CONFIRM_LABEL: Record<string, string> = {
    button: "버튼",
    voice: "음성",
    gesture: "제스처",
};

const WORK_TYPE_OPTIONS: SelectOption[] = WORK_TYPES.map((t) => ({
    id: t.id,
    label: t.label,
}));

// 드롭다운 맨 위에 노출되는 "전체(리셋)" 옵션. 선택 시 내부 상태는 null로 변환.
const WORK_TYPE_ALL_OPTION: SelectOption = { id: WORK_TYPE_ALL.id, label: WORK_TYPE_ALL.label };
const WORK_TYPE_OPTIONS_WITH_ALL: SelectOption[] = [WORK_TYPE_ALL_OPTION, ...WORK_TYPE_OPTIONS];

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

    // standby 모드 (운영 시간대·요일은 interval 필드를 재사용한다)
    const [standbyTrigger, setStandbyTrigger] = useState<string | null>(null);
    const [standbyPlace, setStandbyPlace] = useState<SelectOption | null>(null);
    const [standbyMaxSessionMin, setStandbyMaxSessionMin] = useState<number | null>(20);
    const [standbyCap, setStandbyCap] = useState<StandbyCapability | null>(null);
    const [standbyPlaces, setStandbyPlaces] = useState<SelectOption[]>([]);

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

    // 로봇 + 작업유형별 경로 필터링.
    // 현재 층 필터는 두지 않는다 — 로봇에 등록된 경로는 층과 무관하게 모두 보여야 한다.
    // (로봇의 현재 층은 일시적이고, 다른 층/다층 경로도 예약 대상이다.)
    const filteredPathOptions: SelectOption[] = useMemo(() => {
        return allWorkPaths
            .filter((p) => {
                if (selectedRobot && p.robotName !== selectedRobot.label) return false;
                if (selectedWorkType && (p.taskType ?? "") !== selectedWorkType.label) return false;
                return true;
            })
            .map((p) => ({ id: p.id, label: p.wayName }));
    }, [allWorkPaths, selectedRobot, selectedWorkType]);

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
                const paths = list.map((row: any) => {
                    let stopActions: WorkPathOption['stopActions'];
                    if (row.StopActions) {
                        try {
                            const parsed = JSON.parse(row.StopActions);
                            if (Array.isArray(parsed)) stopActions = parsed;
                        } catch {
                            stopActions = undefined;
                        }
                    }
                    return {
                        id: row.id,
                        wayName: row.WayName,
                        robotName: row.RobotName,
                        wayPoints: row.WayPoints ?? '',
                        taskType: resolveTaskTypeLabel(row.TaskType),
                        floorId: row.FloorId ?? null,
                        stopActions,
                    };
                });
                setAllWorkPaths(paths);
            })
            .catch((e) => {
                console.error('경로 목록 조회 실패', e);
                setAllWorkPaths([]);
            })
            .finally(() => setLoadingPaths(false));
    }, [isOpen]);

    // 대기 장소 후보 (상시 대기 전용)
    useEffect(() => {
        if (!isOpen) return;
        apiFetch(`/DB/places`)
            .then((res) => res.json())
            .then((data) => {
                const list = Array.isArray(data) ? data : (data?.places ?? []);
                setStandbyPlaces(list.map((p: any) => ({ id: p.id, label: p.LacationName ?? p.name ?? `장소 ${p.id}` })));
            })
            .catch(() => setStandbyPlaces([]));
    }, [isOpen]);

    // 로봇이 바뀌면 상시 대기 가능 여부를 다시 판정한다.
    // 판정을 서버와 공유해야 "화면에선 고를 수 있는데 저장에서 막히는" 어긋남이 없다.
    useEffect(() => {
        if (!isOpen || !selectedRobot) { setStandbyCap(null); return; }
        const robotName = robots.find((r) => r.id === Number(selectedRobot.id))?.no ?? selectedRobot.label;
        apiFetch(`/DB/schedule-standby-capability?robot=${encodeURIComponent(robotName)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((cap: StandbyCapability | null) => {
                setStandbyCap(cap);
                // 마이크가 없으면 호출 방식은 버튼으로 고정된다 (PRD §3.6)
                if (cap && !cap.hasMic) setStandbyTrigger('button');
            })
            .catch(() => setStandbyCap(null));
    }, [isOpen, selectedRobot, robots]);

    // 등록 불가 로봇으로 바꾸면 모드를 되돌린다 — 못 저장할 폼을 띄워두지 않는다
    useEffect(() => {
        if (scheduleMode === 'standby' && standbyCap && !standbyCap.allowed) {
            setScheduleMode('once');
        }
    }, [scheduleMode, standbyCap]);

    // 로봇/작업유형/층 변경 시, 현재 선택된 경로가 필터에 안 맞으면 초기화
    useEffect(() => {
        if (!selectedWorkPath) return;
        const match = allWorkPaths.find((p) => {
            if (p.id !== Number(selectedWorkPath.id)) return false;
            if (selectedRobot && p.robotName !== selectedRobot.label) return false;
            if (selectedWorkType && (p.taskType ?? "") !== selectedWorkType.label) return false;
            return true;
        });
        if (!match) setSelectedWorkPath(null);
    }, [selectedRobot, selectedWorkType, allWorkPaths, selectedWorkPath]);

    // 경로를 먼저 선택하면 로봇/작업유형이 비어있을 때 경로 정보로 자동 세팅.
    // 의존성에 selectedRobot/selectedWorkType을 넣지 않아야 사용자가 이후에 비워도
    // 다시 자동 채움이 트리거되지 않음 (무한 루프/의도 무시 방지).
    useEffect(() => {
        if (!selectedWorkPath) return;
        const path = allWorkPaths.find((p) => p.id === Number(selectedWorkPath.id));
        if (!path) return;
        if (path.robotName) {
            const robotMatch = robotOptions.find((r) => r.label === path.robotName);
            if (robotMatch) setSelectedRobot((prev) => prev ?? robotMatch);
        }
        if (path.taskType) {
            const typeMatch = WORK_TYPE_OPTIONS.find((t) => t.label === path.taskType);
            if (typeMatch) setSelectedWorkType((prev) => prev ?? typeMatch);
        }
    }, [selectedWorkPath, allWorkPaths, robotOptions]);

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
            standbyTrigger,
            standbyMaxSessionMin,
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
        const wayName = selectedWorkPath
            ? (allWorkPaths.find((p) => p.id === Number(selectedWorkPath.id))?.wayName ?? selectedWorkPath.label)
            : null;

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
        } else if (scheduleMode === 'standby') {
            payload.ActiveStartTime = makeTimeString(activeStartAmpm!, activeStartHour!, activeStartMin!);
            payload.ActiveEndTime = makeTimeString(activeEndAmpm!, activeEndHour!, activeEndMin!);
            payload.RepeatDays = intervalRepeatDays.length ? intervalRepeatDays.join(',') : null;
            payload.SeriesStartDate = seriesStartDate;
            payload.SeriesEndDate = seriesEndType === 'date' ? seriesEndDate : null;
            payload.StandbyTrigger = standbyTrigger;
            payload.ReturnPlaceId = standbyPlace ? Number(standbyPlace.id) : null;
            payload.StandbyMaxSessionMin = standbyMaxSessionMin;
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

            // 겹침은 차단이 아니라 경고다 — 저장은 됐고 예약 작업이 우선한다(S8)
            const okBody = await res.json().catch(() => null);
            const warnings: string[] = okBody?.warnings ?? [];
            if (warnings.length) {
                showToast(warnings[0], 'error');
            }

            showToast('작업일정이 등록되었습니다.', 'success');
            await onScheduleChanged?.();
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
                            <span className={styles.detailHeaderTitle}>작업 등록</span>
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
                                    options={WORK_TYPE_OPTIONS_WITH_ALL}
                                    value={selectedWorkType ?? WORK_TYPE_ALL_OPTION}
                                    onChange={(opt) => setSelectedWorkType(opt.id === WORK_TYPE_ALL.id ? null : opt)}
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
                                        {(['once', 'weekly', 'interval', 'standby'] as ScheduleMode[]).map((mode) => {
                                            // 상시 대기는 음성 모듈·스피커·목적지 사전이 있어야 의미가 있다.
                                            // 등록만 되고 응대를 못 하면 "왜 안 하지"라는 오해만 남는다(S9).
                                            const blocked = mode === 'standby' && !!standbyCap && !standbyCap.allowed;
                                            return (
                                                <label
                                                    key={mode}
                                                    className={`${styles.modeRadioLabel} ${blocked ? styles.modeRadioDisabled : ''}`}
                                                    title={blocked ? standbyCap!.reason ?? '' : undefined}
                                                >
                                                    <input
                                                        type="radio"
                                                        name="scheduleMode"
                                                        checked={scheduleMode === mode}
                                                        disabled={blocked}
                                                        onChange={() => setScheduleMode(mode)}
                                                    />
                                                    <span>{SCHEDULE_MODE_LABELS[mode]}</span>
                                                </label>
                                            );
                                        })}
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
                                                <div className={styles.repeatEveryday}>
                                                    <CustomCheckbox
                                                        checked={repeatEveryday}
                                                        onChange={(v) => handleEveryday(v, setRepeatDays, setRepeatEveryday)}
                                                        label="매일"
                                                    />
                                                </div>
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
                                                    <DateField
                                                        value={seriesStartDate}
                                                        onChange={setSeriesStartDate}
                                                        minDate={formatDate(today)}
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
                                                        <DateField
                                                            value={seriesEndDate}
                                                            onChange={setSeriesEndDate}
                                                            minDate={seriesStartDate || formatDate(today)}
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
                                                <div className={styles.intervalInputRow}>
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
                                                </div>
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
                                                <div className={styles.repeatEveryday}>
                                                    <CustomCheckbox
                                                        checked={intervalEveryday}
                                                        onChange={(v) => handleEveryday(v, setIntervalRepeatDays, setIntervalEveryday)}
                                                        label="매일"
                                                    />
                                                </div>
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
                                                    <DateField
                                                        value={seriesStartDate}
                                                        onChange={setSeriesStartDate}
                                                        minDate={formatDate(today)}
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
                                                        <DateField
                                                            value={seriesEndDate}
                                                            onChange={setSeriesEndDate}
                                                            minDate={seriesStartDate || formatDate(today)}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        {fieldErrors.seriesEndDate && <span className={styles.fieldError}>{fieldErrors.seriesEndDate}</span>}
                                    </div>
                                </>
                            )}

                            {/* === 상시 대기 (standby) === */}
                            {scheduleMode === 'standby' && (
                                <>
                                    {standbyCap && !standbyCap.hasMic && (
                                        <div className={styles.standbyNotice}>
                                            이 로봇에 <b>마이크가 등록되어 있지 않습니다</b> — 호출 방식이 <b>버튼</b>으로 고정됩니다.
                                            대기 · 안내 이동 · 자동 복귀는 그대로 동작합니다.
                                        </div>
                                    )}

                                    <TimePicker
                                        label="운영 시작"
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
                                        label="운영 종료"
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

                                    {/* 운영 요일 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>운영 요일</div>
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
                                                <div className={styles.repeatEveryday}>
                                                    <CustomCheckbox
                                                        checked={intervalEveryday}
                                                        onChange={(v) => handleEveryday(v, setIntervalRepeatDays, setIntervalEveryday)}
                                                        label="매일"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 호출 방식 — 명시 필드라 "마이크로 등록했는데 실제로는 버튼"이 생길 수 없다 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>호출 방식</div>
                                            <div className={styles.modeRadioGroup}>
                                                {STANDBY_TRIGGERS.map((t) => {
                                                    const disabled = !standbyCap?.allowedTriggers?.includes(t.id);
                                                    return (
                                                        <label
                                                            key={t.id}
                                                            className={`${styles.modeRadioLabel} ${disabled ? styles.modeRadioDisabled : ''}`}
                                                            title={disabled ? '이 로봇에는 마이크가 등록되어 있지 않습니다' : undefined}
                                                        >
                                                            <input
                                                                type="radio"
                                                                name="standbyTrigger"
                                                                checked={standbyTrigger === t.id}
                                                                disabled={disabled}
                                                                onChange={() => setStandbyTrigger(t.id)}
                                                            />
                                                            <span>{t.label}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        {fieldErrors.standbyTrigger && <span className={styles.fieldError}>{fieldErrors.standbyTrigger}</span>}
                                    </div>

                                    {/* 대기 장소 — 응대를 마치면 돌아올 자리 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>대기 장소</div>
                                            <CustomSelect
                                                options={standbyPlaces}
                                                value={standbyPlace}
                                                onChange={setStandbyPlace}
                                                placeholder="미지정 시 충전소에서 대기"
                                            />
                                        </div>
                                    </div>

                                    {/* 응대 1건 최대 — 짧게 잡으면 안내 도중 방문객을 두고 돌아선다 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>응대 1건 최대</div>
                                            <div className={styles.intervalInputRow}>
                                                <NumberSpinner
                                                    value={standbyMaxSessionMin}
                                                    onChange={setStandbyMaxSessionMin}
                                                    min={1}
                                                    max={120}
                                                    placeholder="20"
                                                    error={!!fieldErrors.standbyMaxSessionMin}
                                                    pad={1}
                                                />
                                                <span className={styles.intervalUnit}>분 · 초과 시 강제 복귀</span>
                                            </div>
                                        </div>
                                        {fieldErrors.standbyMaxSessionMin && <span className={styles.fieldError}>{fieldErrors.standbyMaxSessionMin}</span>}
                                    </div>

                                    {standbyCap && (
                                        <div className={styles.standbyHint}>
                                            응대 목적지는 <b>음성 관리 › 목적지 사전</b>이 단일 출처입니다 (현재 {standbyCap.destinationCount}건 연결됨).
                                        </div>
                                    )}

                                    {/* 유효 기간 */}
                                    <div className={styles.itemBoxWrap}>
                                        <div className={styles.itemBox}>
                                            <div>유효 기간</div>
                                            <div className={styles.seriesDateWrap}>
                                                <div className={styles.seriesDateRow}>
                                                    <span className={styles.seriesDateLabel}>시작일</span>
                                                    <DateField
                                                        value={seriesStartDate}
                                                        onChange={setSeriesStartDate}
                                                        minDate={formatDate(today)}
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
                                                        <DateField
                                                            value={seriesEndDate}
                                                            onChange={setSeriesEndDate}
                                                            minDate={seriesStartDate || formatDate(today)}
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

                        {/* === 작업경로 섹션 (상시 대기는 경로가 아니라 대기 장소로 움직인다) === */}
                        {scheduleMode !== 'standby' && (
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
                                            placeholder={selectedRobot ? '경로명을 선택하세요' : '로봇을 먼저 선택하세요'}
                                            error={!!fieldErrors.workPath}
                                            overlay
                                            disabled={!selectedRobot}
                                            emptyMessage="선택된 로봇의 경로가 없습니다"
                                        />
                                    )}
                                </div>
                                {fieldErrors.workPath && <span className={styles.fieldError}>{fieldErrors.workPath}</span>}
                                {selectedWorkPath && (() => {
                                    const matched = allWorkPaths.find((p) => p.id === Number(selectedWorkPath.id));
                                    if (!matched?.wayPoints) return null;
                                    const names = matched.wayPoints.split(' - ').map((s) => s.trim());
                                    const actions = matched.stopActions ?? [];
                                    const hasAnnounce = actions.some((a) => a && (a.announceText || '').trim());
                                    return (
                                        <div className={`${styles.itemBoxWrap} ${styles.pathOrderWrap}`}>
                                            <div className={styles.itemBox}>
                                                <div>경로순서</div>
                                                <div className={styles.pathOrderText}>{matched.wayPoints}</div>
                                            </div>
                                            {/* 도착 안내 미리보기 (읽기 전용) — 편집은 경로 관리에서 */}
                                            {hasAnnounce && (
                                                <div style={{ marginTop: 8, border: '1px solid rgba(146,212,244,.22)', background: 'rgba(146,212,244,.05)', borderRadius: 8, padding: '10px 12px' }}>
                                                    <div style={{ fontSize: 12, fontWeight: 600, color: '#92d4f4', marginBottom: 8 }}>이 경로의 도착 안내</div>
                                                    {names.map((nm, i) => {
                                                        const a = actions[i];
                                                        const text = a && (a.announceText || '').trim();
                                                        if (!text) return null;
                                                        const cf = a?.confirm && a.confirm !== 'none' ? (CONFIRM_LABEL[a.confirm] ?? a.confirm) : null;
                                                        return (
                                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 12, color: '#cfd6e6' }}>
                                                                <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#3B415F', color: '#cfd6e6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                                                                <span style={{ width: 90, flexShrink: 0, color: '#9DADCB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nm}>{nm}</span>
                                                                <span style={{ flex: 1, minWidth: 0, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>&ldquo;{text}&rdquo;</span>
                                                                {cf && <span style={{ fontSize: 11, color: '#dceeff', background: '#2568a8', borderRadius: 4, padding: '1px 8px', flexShrink: 0 }}>확인: {cf}</span>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
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
                        )}
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
