'use client';

import styles from '../ScheduleCrud.module.css';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useRouter } from 'next/navigation';
import DeleteConfirmModal from '@/app/components/modal/CancelConfirmModal';
import RepeatConfirmModal, { type RepeatConfirmMode, type RepeatConfirmScope } from '@/app/(pages)/scheduleManagement/components/modals/RepeatConfirmModals';
import MiniCalendar from '../widgets/MiniCalendar';
import { apiFetch } from "@/app/lib/api";
import { WORK_TYPES, WORK_STATUS, DOWS as DOWS_CONST, SCHEDULE_MODE_LABELS, INTERVAL_PRESETS, AMPM_OPTIONS, HOUR_OPTIONS, MINUTE_OPTIONS, type ScheduleMode, type Dow } from '../../constants';
import { getByteLength } from '../../utils/validation';
import { extractOriginalId } from '../../utils/expandRepeatSchedules';
import { pad2, formatDate, minToHm, hmToMin, toAmpmHour, fromAmpmHour } from '../../utils/datetime';
import { buildInitialForm, formatTimeRangeFromForm, type FormState, type PathDetail, type PathRow } from '../../utils/scheduleForm';
import SharedCustomSelect, { type SelectOption as SharedSelectOption } from '@/app/components/select/CustomSelect';
import NumberSpinner from '../widgets/NumberSpinner';


type MockScheduleData = {
  RobotName: string;
  TaskName: string;
  TaskType: string;
  TaskStatus: string;
  StartDate: string;
  EndDate: string;
  WayName: string;
  Repeat: string;
  Repeat_Day: string | null;
  Repeat_End: string | null;
  // 3모드 필드
  ScheduleMode?: string;
  ExecutionTime?: string | null;
  IntervalMinutes?: number | null;
  ActiveStartTime?: string | null;
  ActiveEndTime?: string | null;
  SeriesStartDate?: string | null;
  SeriesEndDate?: string | null;
};

type ScheduleDetailProps = {
  isOpen: boolean;
  onClose: () => void;
  event: {
    id: string;
    title: string;
    robotNo: string;
    robotType: string;
    dayIndex: number;
    startMin: number;
    endMin: number;
    color?: 'green' | 'yellow' | 'blue' | 'red' | 'orange';
  };
  /** Mock 모드에서 API 대신 사용할 데이터 */
  mockData?: MockScheduleData | null;
  /**
   * (선택) 저장/삭제를 부모 상태(목업 데이터/서버)로 반영할 때 사용
   */
  onUpdate?: (payload: {
    id: string;
    robotNo: string;
    title: string;
    robotType: string;
    workStatus: string;
    startMin: number;
    endMin: number;
    pathName: string;
    pathOrder: string;
  }) => void;
  onDelete?: (id: string) => void;
  onScheduleChanged?: () => void;
};

type SelectOption = { id: number; label: string; order?: string; };




// WorkType, WorkStatus, WORK_TYPES, WORK_STATUS → ../constants.ts 에서 import

type Mode = 'view' | 'edit';

// render helpers (컴포넌트 밖에 정의해야 매 렌더마다 재생성되지 않음)
const FieldRow = ({ label, children, lined }: { label: string; children: React.ReactNode; lined?: boolean }) => (
  <div className={lined ? styles.detailFieldRowLine : styles.detailFieldRow}>
    <div className={styles.detailFieldLabel}>{label}</div>
    <div className={styles.detailFieldValue}>{children}</div>
  </div>
);

const ViewText = ({ value }: { value: string }) => <span className={styles.detailViewText}>{value}</span>;

export default function ScheduleDetail({
  isOpen,
  onClose,
  event,
  mockData,
  onUpdate,
  onDelete,
  onScheduleChanged,
}: ScheduleDetailProps) {
  const router = useRouter();
    const dbId = extractOriginalId(event.id);
    const [mode, setMode] = useState<Mode>('view');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [repeatConfirmOpen, setRepeatConfirmOpen] = useState(false);
    const [repeatConfirmMode, setRepeatConfirmMode] = useState<RepeatConfirmMode>("delete");
    const [repeatScope, setRepeatScope] = useState<RepeatConfirmScope>("this");
    const [showDirtyConfirm, setShowDirtyConfirm] = useState(false);
    const [dirtyAction, setDirtyAction] = useState<'cancel' | 'close'>('cancel');

    const [modifiedAtText, setModifiedAtText] = useState<string | null>(null);

    const [initialForm, setInitialForm] = useState<FormState>(() => buildInitialForm(event));
    const [form, setForm] = useState<FormState>(initialForm);

    // event prop 변경 시 initialForm 재계산
    useEffect(() => {
        setInitialForm(buildInitialForm(event));
    }, [event]);
    const [startDateText, setStartDateText] = useState(formatDate(new Date()));
    const [endDateText, setEndDateText] = useState(formatDate(new Date()));

    // 모달 열릴 때 초기화
    useEffect(() => {
        if (!isOpen) return;
        setMode('view');
        setShowDeleteConfirm(false);
        setForm(initialForm);
        const normalized = formatDate(parseDateText(initialForm.dateText));
        setStartDateText(normalized);
        setEndDateText(normalized);
        setIsStartDateOpen(false);
        setIsEndDateOpen(false);
        setIsRepeatEndDateOpen(false);
    }, [isOpen, initialForm]);

    if (!isOpen) return null;

    const isEditMode = mode === 'edit';

    const parseDateText = (text: string) => {
      const normalized = text.replace(/\./g, "-");
      const parsed = new Date(normalized);
      if (Number.isNaN(parsed.getTime())) {
        const fallback = new Date();
        fallback.setHours(0, 0, 0, 0);
        return fallback;
      }
      return parsed;
    };

    // ===== actions =====
    const openRepeatConfirm = (mode: RepeatConfirmMode) => {
      setRepeatConfirmMode(mode);

      // 이미지 기본 선택값: 삭제=첫번째, 수정=두번째
      const def: RepeatConfirmScope = mode === "edit" ? "thisAndFuture" : "this";
      setRepeatScope(def);

      setRepeatConfirmOpen(true);
    };

    const handleEditStart = () => {
      setFieldErrors({});
      setApiError(null);
      // 반복 작업이면: 범위 선택 모달 먼저
      if (form.repeatEnabled) {
        openRepeatConfirm("edit");
        return;
      }
      setMode('edit');
    };

    const isFormDirty = useMemo(() => {
        return JSON.stringify(form) !== JSON.stringify(initialForm);
    }, [form, initialForm]);

    const handleEditCancel = () => {
        if (isFormDirty) {
            setDirtyAction('cancel');
            setShowDirtyConfirm(true);
            return;
        }
        setFieldErrors({});
        setApiError(null);
        setForm(initialForm);
        setMode('view');
    };

    const handleSafeClose = () => {
        if (isEditMode && isFormDirty) {
            setDirtyAction('close');
            setShowDirtyConfirm(true);
            return;
        }
        onClose();
    };

    useModalBehavior({
        isOpen,
        onClose: handleSafeClose,
        disabled: repeatConfirmOpen || showDeleteConfirm || showDirtyConfirm,
    });

    const handleDirtyConfirmLeave = () => {
        setShowDirtyConfirm(false);
        setFieldErrors({});
        setApiError(null);
        if (dirtyAction === 'cancel') {
            setForm(initialForm);
            setMode('view');
        } else {
            onClose();
        }
    };

    const [saving, setSaving] = useState(false);
    const [apiError, setApiError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

    const makeDetailDateTime = (dateStr: string, ampm: string, hour: number, minute: number) => {
        let h = hour;
        if (ampm === "오후" && h !== 12) h += 12;
        if (ampm === "오전" && h === 12) h = 0;
        return `${dateStr} ${pad2(h)}:${pad2(minute)}:00`;
    };

    const validateForm = (): Record<string, string> => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = "작업명을 입력하세요.";
        if (!form.workType) errors.workType = "작업유형을 선택하세요.";
        if (!form.workStatus) errors.workStatus = "작업상태를 선택하세요.";
        if (!form.pathName) errors.pathName = "작업경로를 선택하세요.";

        // 모드별 검증
        if (form.scheduleMode === 'once') {
            const startDT = makeDetailDateTime(startDateText, form.startAmpm, form.startHour, form.startMin);
            const now = new Date();
            const startDate = new Date(startDT.replace(" ", "T"));
            if (startDate < now) {
                errors.pastDate = "실행 일시가 현재 시각보다 이전입니다.";
            }
        }

        if (form.scheduleMode === 'weekly') {
            if (form.repeatDays.length === 0) errors.repeatDays = "반복요일을 최소 1일 선택하세요.";
            if (form.repeatEndType === "date" && form.repeatEndDate && form.seriesStartDate) {
                if (form.repeatEndDate < form.seriesStartDate) {
                    errors.seriesEndDate = "종료일이 시작일보다 빠릅니다.";
                }
            }
        }

        if (form.scheduleMode === 'interval') {
            if (!form.intervalMinutes || form.intervalMinutes < 1) {
                errors.intervalMinutes = "반복 간격을 1분 이상 입력하세요.";
            }
            if (form.repeatEndType === "date" && form.repeatEndDate && form.seriesStartDate) {
                if (form.repeatEndDate < form.seriesStartDate) {
                    errors.seriesEndDate = "종료일이 시작일보다 빠릅니다.";
                }
            }
        }
        return errors;
    };

    const handleEditSave = async () => {
        setApiError(null);
        const errors = validateForm();
        setFieldErrors(errors);
        if (Object.keys(errors).length > 0) return;

        const startDT = makeDetailDateTime(startDateText, form.startAmpm, form.startHour, form.startMin);
        const endDT = makeDetailDateTime(endDateText, form.endAmpm, form.endHour, form.endMin);

        const payload: Record<string, any> = {
            id: event.id,
            TaskStatus: form.workStatus,
            ScheduleMode: form.scheduleMode,
            ...(repeatScope ? { RepeatScope: repeatScope } : {}),
        };

        if (form.scheduleMode === 'once') {
            payload.StartTime = startDT;
        } else if (form.scheduleMode === 'weekly') {
            payload.ExecutionTime = form.executionTimes.length > 0
              ? form.executionTimes.join(",")
              : `${pad2(fromAmpmHour(form.startAmpm, form.startHour))}:${pad2(form.startMin)}`;
            payload.RepeatDays = form.repeatDays.join(",");
            payload.SeriesStartDate = form.seriesStartDate || startDateText;
            payload.SeriesEndDate = form.repeatEndType === "date" ? form.repeatEndDate : null;
        } else if (form.scheduleMode === 'interval') {
            payload.ActiveStartTime = form.activeStartTime;
            payload.ActiveEndTime = form.activeEndTime;
            payload.IntervalMinutes = form.intervalMinutes;
            payload.RepeatDays = form.intervalRepeatDays.length ? form.intervalRepeatDays.join(",") : null;
            payload.SeriesStartDate = form.seriesStartDate || startDateText;
            payload.SeriesEndDate = form.repeatEndType === "date" ? form.repeatEndDate : null;
        }

        setSaving(true);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await apiFetch(`/DB/schedule/${dbId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.detail || "수정 실패");
            }
            onUpdate?.({
                id: event.id,
                robotNo: form.robotNo,
                title: form.title,
                robotType: form.workType,
                workStatus: form.workStatus,
                startMin: hmToMin(fromAmpmHour(form.startAmpm, form.startHour), form.startMin),
                endMin: hmToMin(fromAmpmHour(form.endAmpm, form.endHour), form.endMin),
                pathName: form.pathName,
                pathOrder: form.pathOrder,
            });
            onScheduleChanged?.();
            setMode('view');
        } catch (e: any) {
            console.error("스케줄 수정 실패", e);
            if (e?.name === 'AbortError') {
                setApiError("서버 응답 시간이 초과되었습니다. 다시 시도해주세요.");
            } else {
                setApiError(e instanceof Error && e.message !== "수정 실패" ? e.message : "스케줄 수정에 실패했습니다.");
            }
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = () => {
      // ✅ 반복 작업이면: 범위 선택 모달 먼저
      if (form.repeatEnabled) {
        openRepeatConfirm("delete");
        return;
      }
      setShowDeleteConfirm(true);
    };

    const [robots, setRobots] = useState<SelectOption[]>([]);

    useEffect(() => {
      if (!isOpen) return;

      apiFetch(`/DB/robots`)
        .then((res) => res.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : (data?.robots ?? []);
          setRobots(list.map((r: any, i: number) => ({
            id: i,
            label: r.RobotName ?? r.no ?? '',
          })));
        })
        .catch((e) => {
          console.error("로봇 목록 조회 실패", e);
          setRobots([]);
        });
    }, [isOpen]);

    const [pathOptions, setPathOptions] = useState<SelectOption[]>([]);

   useEffect(() => {
    if (!isOpen) return;

    apiFetch(`/DB/getpath`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.paths ?? []);
        setPathOptions(
          list.map((p: any) => ({
            id: p.id,
            label: p.WayName,
            order: p.WayPoints ?? "",
          }))
        );
      })
      .catch((e) => {
        console.error("경로 목록 조회 실패", e);
        setPathOptions([]);
      });
  }, [isOpen]);

    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

  const applyDetailData = (data: MockScheduleData) => {
    const start = new Date(data.StartDate);
    const end = new Date(data.EndDate);

    const startH24 = start.getHours();
    const endH24 = end.getHours();

    const matchedPath = pathOptions.find(
      (p) => p.label === data.WayName
    );

    const startAmpm = startH24 < 12 ? '오전' : '오후';
    const endAmpm = endH24 < 12 ? '오전' : '오후';

    const mode = (data.ScheduleMode || (data.Repeat === "Y" ? "weekly" : "once")) as FormState["scheduleMode"];

    const newForm: FormState = {
      robotNo: data.RobotName,
      title: data.TaskName,
      workType: data.TaskType,
      workStatus: data.TaskStatus,

      dateText: formatDate(start),
      dowText: data.Repeat_Day ?? '',

      startAmpm,
      startHour: startH24 % 12 === 0 ? 12 : startH24 % 12,
      startMin: start.getMinutes(),

      endAmpm,
      endHour: endH24 % 12 === 0 ? 12 : endH24 % 12,
      endMin: end.getMinutes(),

      pathId: null,
      pathName: data.WayName,
      pathDetails: [],
      pathOrder: matchedPath?.order ?? "",

      scheduleMode: mode,

      repeatEnabled: mode === "weekly" || mode === "interval",
      repeatDays: mode === "weekly" && data.Repeat_Day
        ? data.Repeat_Day.split(",") as Array<'월'|'화'|'수'|'목'|'금'|'토'|'일'>
        : [],
      repeatEveryday: data.Repeat_Day === '월,화,수,목,금,토,일',
      repeatEndType: (data.SeriesEndDate || data.Repeat_End) ? 'date' : 'none',
      repeatEndDate: data.SeriesEndDate ?? data.Repeat_End ?? '',

      executionTimes: data.ExecutionTime
        ? data.ExecutionTime.split(",").map((t: string) => t.trim())
        : [],

      intervalMinutes: data.IntervalMinutes ?? null,
      activeStartTime: data.ActiveStartTime ?? '09:00',
      activeEndTime: data.ActiveEndTime ?? '18:00',
      intervalRepeatDays: mode === "interval" && data.Repeat_Day
        ? data.Repeat_Day.split(",") as Array<'월'|'화'|'수'|'목'|'금'|'토'|'일'>
        : [],

      seriesStartDate: data.SeriesStartDate ?? formatDate(start),
      seriesEndDate: data.SeriesEndDate ?? data.Repeat_End ?? '',
    };

    setForm(newForm);
    setInitialForm(newForm);

    setStartDateText(formatDate(start));
    setEndDateText(formatDate(end));
    setModifiedAtText(null);
  };

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);

    // Mock 데이터가 있으면 API 호출 없이 바로 적용
    if (mockData) {
      applyDetailData(mockData);
      setLoading(false);
      return;
    }

    apiFetch(`/DB/schedule/${dbId}`)
      .then(res => res.json())
      .then(data => {
        applyDetailData(data);

        // 수정 일시 (API에 필드가 있으면 사용)
        if (data.UpdatedAt || data.updated_at) {
          const updatedDate = new Date(data.UpdatedAt ?? data.updated_at);
          const h = updatedDate.getHours();
          const ampm = h < 12 ? '오전' : '오후';
          const h12 = h % 12 === 0 ? 12 : h % 12;
          setModifiedAtText(
            `${updatedDate.getFullYear()}.${pad2(updatedDate.getMonth() + 1)}.${pad2(updatedDate.getDate())} ${ampm} ${pad2(h12)}:${pad2(updatedDate.getMinutes())}:${pad2(updatedDate.getSeconds())}`
          );
        } else {
          setModifiedAtText(null);
        }
      })
      .catch((e) => {
        console.error("스케줄 상세 조회 실패", e);
        setFetchError("데이터를 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, event.id, mockData]);

  // pathOptions 로드 후 경로순서 매칭
  useEffect(() => {
    if (!isOpen || pathOptions.length === 0 || !form.pathName) return;
    const matched = pathOptions.find((p) => p.label === form.pathName);
    if (matched?.order && !form.pathOrder) {
      setForm((p) => ({ ...p, pathOrder: matched.order ?? "" }));
    }
  }, [pathOptions, isOpen, form.pathName, form.pathOrder]);

    const handleDeleteCancel = () => setShowDeleteConfirm(false);

    const handleDeleteConfirm = async () => {
        try {
            const deletePayload = repeatScope ? { RepeatScope: repeatScope } : {};
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await apiFetch(`/DB/schedule/${dbId}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: Object.keys(deletePayload).length > 0 ? JSON.stringify(deletePayload) : undefined,
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) throw new Error("삭제 실패");
            onDelete?.(event.id);
            onScheduleChanged?.();
            setShowDeleteConfirm(false);
            onClose();
        } catch (e) {
            console.error("스케줄 삭제 실패", e);
            setApiError("스케줄 삭제에 실패했습니다.");
            setShowDeleteConfirm(false);
        }
    };

    const handleRepeatConfirmCancel = () => {
      setRepeatConfirmOpen(false);
    };

    const handleRepeatConfirmOk = (scope: RepeatConfirmScope) => {
      setRepeatConfirmOpen(false);
      setRepeatScope(scope);

      if (repeatConfirmMode === "edit") {
        setMode("edit");
        return;
      }

      // delete: 실제 DELETE API를 호출하도록 확인 모달로 이동
      setShowDeleteConfirm(true);
    };



    // ===== view helpers =====
    const workTypeTitle = useMemo(() => (form.workType ?? '').replace(' / ', '/'), [form.workType]);

    // 모드별 보기 텍스트
    const viewScheduleModeLabel = form.scheduleMode === 'once' ? '단일 실행'
      : form.scheduleMode === 'weekly' ? '요일 반복'
      : '주기 반복';

    const viewTimeText = form.scheduleMode === 'once'
      ? `${startDateText} ${form.startAmpm} ${pad2(form.startHour)}:${pad2(form.startMin)}`
      : form.scheduleMode === 'weekly'
        ? form.executionTimes.length > 0
          ? `매주 ${form.repeatDays.join(',')} ${form.executionTimes.join(', ')}`
          : `매주 ${form.repeatDays.join(',')} ${form.startAmpm} ${pad2(form.startHour)}:${pad2(form.startMin)}`
        : `${form.activeStartTime}~${form.activeEndTime} 매 ${form.intervalMinutes ?? 0}분`;

    const viewSeriesText = (form.scheduleMode === 'weekly' || form.scheduleMode === 'interval')
      ? `${form.seriesStartDate}${form.repeatEndType === 'date' && form.repeatEndDate ? ` ~ ${form.repeatEndDate}` : ' ~ 무기한'}`
      : '';

    const viewDowText = form.scheduleMode === 'interval' && form.intervalRepeatDays.length > 0
      ? form.intervalRepeatDays.join(',')
      : form.dowText;


    // 달력/반복종료 달력 open 상태
    const [isStartDateOpen, setIsStartDateOpen] = useState(false);
    const [isEndDateOpen, setIsEndDateOpen] = useState(false);
    const [isRepeatEndDateOpen, setIsRepeatEndDateOpen] = useState(false);

    const startDateWrapperRef = useRef<HTMLDivElement>(null);
    const endDateWrapperRef = useRef<HTMLDivElement>(null);
    const repeatEndDateWrapperRef = useRef<HTMLDivElement>(null);

    const DOWS: Array<'월'|'화'|'수'|'목'|'금'|'토'|'일'> = ['월','화','수','목','금','토','일'];

    const toggleRepeatDay = (d: (typeof DOWS)[number]) => {
    setForm((p) => {
        const exists = p.repeatDays.includes(d);
        const nextDays = exists ? p.repeatDays.filter((x) => x !== d) : [...p.repeatDays, d];
        return { ...p, repeatDays: nextDays, repeatEveryday: nextDays.length === 7 };
    });
    };

    const toggleEveryday = (checked: boolean) => {
    setForm((p) => ({
        ...p,
        repeatEveryday: checked,
        repeatDays: checked ? [...DOWS] : [],
    }));
    };

    const setRepeatEnabled = (enabled: boolean) => {
      setForm((p) => ({
          ...p,
          repeatEnabled: enabled,
          // 반복 안함으로 바꾸면 하위값 정리(선택)
          ...(enabled
          ? {}
          : {
              repeatDays: [],
              repeatEveryday: false,
              repeatEndType: 'none',
              }),
      }));
      if (!enabled) {
        setIsRepeatEndDateOpen(false);
      }
    };

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            const t = e.target as Node;
            if (startDateWrapperRef.current && !startDateWrapperRef.current.contains(t)) setIsStartDateOpen(false);
            if (endDateWrapperRef.current && !endDateWrapperRef.current.contains(t)) setIsEndDateOpen(false);
            if (repeatEndDateWrapperRef.current && !repeatEndDateWrapperRef.current.contains(t)) setIsRepeatEndDateOpen(false);
        };

        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, []);

  return (
    <>
      <div className={styles.scheduleModalOverlay} onClick={handleSafeClose}>
        <div className={styles.scheduleModalContainer} onClick={(e) => e.stopPropagation()}>

          {/* 헤더 */}
          <div className={styles.detailHeader}>
            <div className={styles.detailHeaderLeft}>
              <img src="/icon/robot_schedule_w.png" alt="" className={styles.detailHeaderIcon} />
              <h2>{isEditMode ? '작업 수정' : '작업 상세'}</h2>
            </div>
            <button className={styles.CloseBtn} onClick={handleSafeClose}>✕</button>
          </div>

          {/* 로딩 상태 */}
          {loading && (
            <div className={styles.detailLoading}>
              <div className={styles.detailSpinner} />
              <span>데이터를 불러오는 중...</span>
            </div>
          )}

          {/* fetch 에러 */}
          {!loading && fetchError && (
            <div className={styles.detailLoading}>
              <span>{fetchError}</span>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() => {
                  setFetchError(null);
                  setLoading(true);
                  apiFetch(`/DB/schedule/${dbId}`)
                    .then(res => res.json())
                    .then(data => {
                      // 재시도 시 동일한 로직 실행 (간략화)
                      const start = new Date(data.StartDate);
                      const end = new Date(data.EndDate);
                      setStartDateText(formatDate(start));
                      setEndDateText(formatDate(end));
                    })
                    .catch(() => setFetchError("데이터를 불러오지 못했습니다."))
                    .finally(() => setLoading(false));
                }}
              >
                다시 시도
              </button>
            </div>
          )}

          {/* 본문 */}
          {!loading && !fetchError && <div className={styles.detailBody}>
            {/* === 기본 정보 섹션 === */}
            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>기본 정보<span className={styles.detailSectionLine} /></div>

              <FieldRow label="로봇명" lined>
                {isEditMode ? (
                  <ViewText value={form.robotNo}/>
                ) : (
                  <span className={styles.detailRobotBadge}>
                    <img src="/icon/robot_w.png" alt="" className={styles.detailRobotIcon} />
                    {form.robotNo}
                  </span>
                )}
              </FieldRow>

              <FieldRow label="작업명" lined>
                {isEditMode ? (
                  <div className={styles.inputWithByte}>
                    <input
                      className={`${styles.editInput} ${fieldErrors.title ? styles.inputError : ''}`}
                      value={form.title}
                      onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                      placeholder="25자(50byte) 이내로 작성하세요"
                      maxLength={25}
                    />
                    <span className={`${styles.byteInline} ${getByteLength(form.title) > 40 ? styles.byteCounterWarn : ''}`}>
                      {getByteLength(form.title)}/50
                    </span>
                    {fieldErrors.title && <span className={styles.fieldError}>{fieldErrors.title}</span>}
                  </div>
                ) : (
                  <span className={styles.detailTitleText}>{form.title}</span>
                )}
              </FieldRow>

              <FieldRow label="작업유형" lined>
              {isEditMode ? (
                  <SharedCustomSelect
                    placeholder="작업유형을 선택하세요"
                    value={WORK_TYPES.find(t => t.label === form.workType) ?? null}
                    options={WORK_TYPES}
                    onChange={(opt) => setForm((p) => ({ ...p, workType: opt.label }))}
                    error={!!fieldErrors.workType}
                  />
              ) : (
                  <ViewText value={form.workType} />
              )}
              </FieldRow>
              {isEditMode && fieldErrors.workType && (
                <span className={styles.fieldError}>{fieldErrors.workType}</span>
              )}
            </div>

            {/* === 일시 섹션 === */}
            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>작업 일시<span className={styles.detailSectionLine} /></div>

              {isEditMode ? (
                <>
                  {/* 실행 방식 라디오 */}
                  <FieldRow label="실행 방식">
                    <div className={styles.modeRadioGroup}>
                      {(['once', 'weekly', 'interval'] as ScheduleMode[]).map((m) => (
                        <label key={m} className={styles.modeRadioLabel}>
                          <input type="radio" name="editScheduleMode" checked={form.scheduleMode === m}
                            onChange={() => setForm((p) => ({ ...p, scheduleMode: m, repeatEnabled: m !== 'once' }))}
                          />
                          <span>{SCHEDULE_MODE_LABELS[m]}</span>
                        </label>
                      ))}
                    </div>
                  </FieldRow>

                  {/* === once: 날짜 + 시각 === */}
                  {form.scheduleMode === 'once' && (
                    <div className={styles.detailDateRow}>
                      <div className={styles.detailFieldLabel}>실행 일시</div>
                      <div className={styles.detailDateControls}>
                        <div ref={startDateWrapperRef} className={styles.detailDatePicker}>
                          {startDateText}
                          <img src="/icon/search_calendar.png" alt=""
                            onClick={(e) => { e.stopPropagation(); setIsStartDateOpen((v) => !v); }}
                          />
                          {isStartDateOpen && (
                            <div className={styles.calendarPopover} onClick={(e) => e.stopPropagation()}>
                              <MiniCalendar
                                value={parseDateText(startDateText)} showTodayButton size="modal"
                                onPickDate={(date) => {
                                  const next = formatDate(date);
                                  setStartDateText(next); setEndDateText(next);
                                  setForm((p) => ({ ...p, dateText: next }));
                                  setIsStartDateOpen(false);
                                }}
                              />
                            </div>
                          )}
                        </div>
                        <SharedCustomSelect options={AMPM_OPTIONS}
                          value={AMPM_OPTIONS.find(o => o.label === form.startAmpm) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, startAmpm: opt.label as FormState["startAmpm"] }))}
                          placeholder="오전" compact
                        />
                        <SharedCustomSelect options={HOUR_OPTIONS}
                          value={HOUR_OPTIONS.find(o => o.label === String(form.startHour).padStart(2, "0")) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, startHour: Number(opt.label) }))}
                          placeholder="01" compact
                        />
                        <NumberSpinner value={form.startMin}
                          onChange={(v) => setForm((p) => ({ ...p, startMin: v }))}
                          min={0} max={59} placeholder="00"
                        />
                      </div>
                    </div>
                  )}

                  {/* === weekly: 다중 시각 + 요일 + 유효기간 === */}
                  {form.scheduleMode === 'weekly' && (
                    <>
                      <div className={styles.detailFieldLabel} style={{ marginBottom: 6 }}>실행 시각</div>
                      {(form.executionTimes.length > 0 ? form.executionTimes : [""]).map((t, i) => {
                        const [hRaw, mRaw] = (t || "00:00").split(":").map(Number);
                        const ampm = hRaw < 12 ? "오전" : "오후";
                        const h12 = hRaw % 12 === 0 ? 12 : hRaw % 12;
                        const updateTime = (newH24: number, newM: number) => {
                          const next = [...form.executionTimes];
                          next[i] = `${String(newH24).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
                          setForm((p) => ({ ...p, executionTimes: next }));
                        };
                        return (
                          <div key={i} className={styles.detailDateRow} style={{ marginBottom: 6 }}>
                            <div className={styles.detailFieldLabel} style={{ minWidth: 30 }}>#{i + 1}</div>
                            <div className={styles.detailDateControls}>
                              <SharedCustomSelect options={AMPM_OPTIONS}
                                value={AMPM_OPTIONS.find(o => o.label === ampm) ?? null}
                                onChange={(opt) => {
                                  let h = h12 % 12;
                                  if (opt.label === "오후") h += 12;
                                  updateTime(h, mRaw);
                                }}
                                placeholder="오전" compact
                              />
                              <SharedCustomSelect options={HOUR_OPTIONS}
                                value={HOUR_OPTIONS.find(o => o.label === String(h12).padStart(2, "0")) ?? null}
                                onChange={(opt) => {
                                  let h = Number(opt.label);
                                  if (ampm === "오후" && h !== 12) h += 12;
                                  if (ampm === "오전" && h === 12) h = 0;
                                  updateTime(h, mRaw);
                                }}
                                placeholder="01" compact
                              />
                              <NumberSpinner value={mRaw}
                                onChange={(v) => updateTime(hRaw, v)}
                                min={0} max={59} placeholder="00"
                              />
                              {form.executionTimes.length > 1 && (
                                <button type="button" className={styles.execTimeRemoveBtn}
                                  onClick={() => setForm((p) => ({ ...p, executionTimes: p.executionTimes.filter((_, j) => j !== i) }))}
                                >✕</button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <button type="button" className={styles.execTimeAddBtn}
                        onClick={() => setForm((p) => ({ ...p, executionTimes: [...p.executionTimes, "09:00"] }))}
                      >+ 시각 추가</button>
                      <FieldRow label="반복 요일">
                        <div className={styles.repeatDayWrap}>
                          <div className={styles.repeatDayBtns}>
                            {DOWS.map((d) => (
                              <button key={d} type="button"
                                className={`${styles.repeatDayBtn} ${form.repeatDays.includes(d) ? styles.repeatDayBtnActive : ''}`}
                                onClick={() => toggleRepeatDay(d)}
                              >{d}</button>
                            ))}
                          </div>
                          <label className={styles.repeatEveryday} onClick={() => toggleEveryday(!form.repeatEveryday)}>
                            <img
                              src={form.repeatEveryday ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                              alt=""
                              className={styles.repeatEverydayChk}
                            />
                            매일
                          </label>
                        </div>
                      </FieldRow>
                      {fieldErrors.repeatDays && <span className={styles.fieldError}>{fieldErrors.repeatDays}</span>}
                      <FieldRow label="유효 기간">
                        <div className={styles.seriesDateWrap}>
                          <input type="date" value={form.seriesStartDate}
                            onChange={(e) => setForm((p) => ({ ...p, seriesStartDate: e.target.value }))}
                            className={styles.seriesDateInput}
                          />
                          <span>~</span>
                          <div className={styles.seriesEndOptions}>
                            <label>
                              <input type="radio" checked={form.repeatEndType === 'none'}
                                onChange={() => setForm((p) => ({ ...p, repeatEndType: 'none' }))} />
                              무기한
                            </label>
                            <label>
                              <input type="radio" checked={form.repeatEndType === 'date'}
                                onChange={() => setForm((p) => ({ ...p, repeatEndType: 'date', repeatEndDate: p.repeatEndDate || formatDate(new Date()) }))} />
                              <input type="date" value={form.repeatEndDate}
                                onChange={(e) => setForm((p) => ({ ...p, repeatEndDate: e.target.value }))}
                                min={form.seriesStartDate}
                                disabled={form.repeatEndType !== 'date'}
                                className={`${styles.seriesDateInput} ${form.repeatEndType !== 'date' ? styles.disabled : ''}`}
                              />
                            </label>
                          </div>
                        </div>
                      </FieldRow>
                      {fieldErrors.seriesEndDate && <span className={styles.fieldError}>{fieldErrors.seriesEndDate}</span>}
                    </>
                  )}

                  {/* === interval: 활동시간 + 간격 + 요일 + 유효기간 === */}
                  {form.scheduleMode === 'interval' && (
                    <>
                      <div className={styles.detailDateRow}>
                        <div className={styles.detailFieldLabel}>활동 시작</div>
                        <div className={styles.detailDateControls}>
                          <SharedCustomSelect options={AMPM_OPTIONS}
                            value={AMPM_OPTIONS.find(o => o.label === (parseInt(form.activeStartTime.split(':')[0]) < 12 ? '오전' : '오후')) ?? null}
                            onChange={(opt) => {
                              const [hh, mm] = form.activeStartTime.split(':');
                              let h = parseInt(hh) % 12;
                              if (opt.label === '오후') h += 12;
                              setForm((p) => ({ ...p, activeStartTime: `${String(h).padStart(2,'0')}:${mm}` }));
                            }}
                            placeholder="오전" compact
                          />
                          <SharedCustomSelect options={HOUR_OPTIONS}
                            value={(() => { let h = parseInt(form.activeStartTime.split(':')[0]) % 12; if (h === 0) h = 12; return HOUR_OPTIONS.find(o => o.label === String(h).padStart(2,'0')) ?? null; })()}
                            onChange={(opt) => {
                              const [hh, mm] = form.activeStartTime.split(':');
                              const ispm = parseInt(hh) >= 12;
                              let h = Number(opt.label);
                              if (ispm && h !== 12) h += 12;
                              if (!ispm && h === 12) h = 0;
                              setForm((p) => ({ ...p, activeStartTime: `${String(h).padStart(2,'0')}:${mm}` }));
                            }}
                            placeholder="09" compact
                          />
                          <NumberSpinner value={parseInt(form.activeStartTime.split(':')[1]) || 0}
                            onChange={(v) => {
                              const hh = form.activeStartTime.split(':')[0];
                              setForm((p) => ({ ...p, activeStartTime: `${hh}:${String(v).padStart(2,'0')}` }));
                            }}
                            min={0} max={59} placeholder="00"
                          />
                        </div>
                      </div>
                      <div className={styles.detailDateRow}>
                        <div className={styles.detailFieldLabel}>활동 종료</div>
                        <div className={styles.detailDateControls}>
                          <SharedCustomSelect options={AMPM_OPTIONS}
                            value={AMPM_OPTIONS.find(o => o.label === (parseInt(form.activeEndTime.split(':')[0]) < 12 ? '오전' : '오후')) ?? null}
                            onChange={(opt) => {
                              const [hh, mm] = form.activeEndTime.split(':');
                              let h = parseInt(hh) % 12;
                              if (opt.label === '오후') h += 12;
                              setForm((p) => ({ ...p, activeEndTime: `${String(h).padStart(2,'0')}:${mm}` }));
                            }}
                            placeholder="오후" compact
                          />
                          <SharedCustomSelect options={HOUR_OPTIONS}
                            value={(() => { let h = parseInt(form.activeEndTime.split(':')[0]) % 12; if (h === 0) h = 12; return HOUR_OPTIONS.find(o => o.label === String(h).padStart(2,'0')) ?? null; })()}
                            onChange={(opt) => {
                              const [hh, mm] = form.activeEndTime.split(':');
                              const ispm = parseInt(hh) >= 12;
                              let h = Number(opt.label);
                              if (ispm && h !== 12) h += 12;
                              if (!ispm && h === 12) h = 0;
                              setForm((p) => ({ ...p, activeEndTime: `${String(h).padStart(2,'0')}:${mm}` }));
                            }}
                            placeholder="06" compact
                          />
                          <NumberSpinner value={parseInt(form.activeEndTime.split(':')[1]) || 0}
                            onChange={(v) => {
                              const hh = form.activeEndTime.split(':')[0];
                              setForm((p) => ({ ...p, activeEndTime: `${hh}:${String(v).padStart(2,'0')}` }));
                            }}
                            min={0} max={59} placeholder="00"
                          />
                        </div>
                      </div>
                      <FieldRow label="반복 간격">
                        <div className={styles.intervalInputWrap}>
                          <NumberSpinner value={form.intervalMinutes} onChange={(v) => setForm((p) => ({ ...p, intervalMinutes: v }))}
                            min={1} max={1440} placeholder="10" pad={1} error={!!fieldErrors.intervalMinutes}
                          />
                          <span className={styles.intervalUnit}>분마다</span>
                          <div className={styles.intervalPresets}>
                            {INTERVAL_PRESETS.map((p) => (
                              <button key={p} type="button"
                                className={`${styles.intervalPresetBtn} ${form.intervalMinutes === p ? styles.intervalPresetActive : ''}`}
                                onClick={() => setForm((prev) => ({ ...prev, intervalMinutes: p }))}
                              >{p}분</button>
                            ))}
                          </div>
                        </div>
                      </FieldRow>
                      {fieldErrors.intervalMinutes && <span className={styles.fieldError}>{fieldErrors.intervalMinutes}</span>}
                      <FieldRow label="반복 요일">
                        <div className={styles.repeatDayWrap}>
                          <div className={styles.repeatDayBtns}>
                            {DOWS.map((d) => (
                              <button key={d} type="button"
                                className={`${styles.repeatDayBtn} ${form.intervalRepeatDays.includes(d) ? styles.repeatDayBtnActive : ''}`}
                                onClick={() => {
                                  setForm((p) => {
                                    const days = p.intervalRepeatDays.includes(d)
                                      ? p.intervalRepeatDays.filter(x => x !== d)
                                      : [...p.intervalRepeatDays, d as any];
                                    return { ...p, intervalRepeatDays: days };
                                  });
                                }}
                              >{d}</button>
                            ))}
                          </div>
                          <label className={styles.repeatEveryday} onClick={() => setForm((p) => ({ ...p, intervalRepeatDays: p.intervalRepeatDays.length === 7 ? [] : [...DOWS] as any }))}>
                            <img
                              src={form.intervalRepeatDays.length === 7 ? "/icon/robot_chk.png" : "/icon/robot_none_chk.png"}
                              alt=""
                              className={styles.repeatEverydayChk}
                            />
                            매일
                          </label>
                        </div>
                      </FieldRow>
                      <FieldRow label="유효 기간">
                        <div className={styles.seriesDateWrap}>
                          <input type="date" value={form.seriesStartDate}
                            onChange={(e) => setForm((p) => ({ ...p, seriesStartDate: e.target.value }))}
                            className={styles.seriesDateInput}
                          />
                          <span>~</span>
                          <div className={styles.seriesEndOptions}>
                            <label>
                              <input type="radio" checked={form.repeatEndType === 'none'}
                                onChange={() => setForm((p) => ({ ...p, repeatEndType: 'none' }))} />
                              무기한
                            </label>
                            <label>
                              <input type="radio" checked={form.repeatEndType === 'date'}
                                onChange={() => setForm((p) => ({ ...p, repeatEndType: 'date', repeatEndDate: p.repeatEndDate || formatDate(new Date()) }))} />
                              <input type="date" value={form.repeatEndDate}
                                onChange={(e) => setForm((p) => ({ ...p, repeatEndDate: e.target.value }))}
                                min={form.seriesStartDate}
                                disabled={form.repeatEndType !== 'date'}
                                className={`${styles.seriesDateInput} ${form.repeatEndType !== 'date' ? styles.disabled : ''}`}
                              />
                            </label>
                          </div>
                        </div>
                      </FieldRow>
                      {fieldErrors.seriesEndDate && <span className={styles.fieldError}>{fieldErrors.seriesEndDate}</span>}
                    </>
                  )}
                </>
              ) : (
                <>
                  {/* 실행 방식 뱃지 */}
                  <FieldRow label="실행 방식" lined>
                    <span className={`${styles.modeBadge} ${
                      form.scheduleMode === 'once' ? styles.modeBadgeOnce
                      : form.scheduleMode === 'weekly' ? styles.modeBadgeWeekly
                      : styles.modeBadgeInterval
                    }`}>
                      <span className={styles.modeBadgeDot} />
                      {viewScheduleModeLabel}
                    </span>
                  </FieldRow>

                  {/* === once 모드 보기 === */}
                  {form.scheduleMode === 'once' && (
                    <div className={styles.timeCardWrap}>
                      <div className={styles.timeCard}>
                        <div className={styles.timeCardIcon}>⏱</div>
                        <div className={styles.timeCardBody}>
                          <span className={styles.timeCardLabel}>실행 일시</span>
                          <span className={styles.timeCardValue}>
                            {form.startAmpm} {pad2(form.startHour)}:{pad2(form.startMin)}
                          </span>
                          <span className={styles.timeCardSub}>{startDateText}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* === weekly 모드 보기 === */}
                  {form.scheduleMode === 'weekly' && (
                    <div className={styles.timeCardWrap}>
                      {/* 실행 시각들 */}
                      <FieldRow label="실행 시각" lined>
                        <div className={styles.execTimeTags}>
                          {form.executionTimes.length > 0
                            ? form.executionTimes.map((t, i) => (
                                <span key={t} className={styles.execTimeTag}>
                                  <span className={styles.execTimeTagIndex}>#{i + 1}</span>
                                  {t}
                                </span>
                              ))
                            : <span className={styles.execTimeTag}>
                                {form.startAmpm} {pad2(form.startHour)}:{pad2(form.startMin)}
                              </span>
                          }
                        </div>
                      </FieldRow>
                      {/* 반복 요일 칩 */}
                      <FieldRow label="반복 요일" lined>
                        <div className={styles.dowChips}>
                          {(['월','화','수','목','금','토','일'] as const).map((d) => (
                            <span key={d} className={`${styles.dowChip} ${form.repeatDays.includes(d) ? styles.dowChipActive : ''}`}>
                              {d}
                            </span>
                          ))}
                        </div>
                      </FieldRow>
                      {/* 유효 기간 */}
                      {(form.seriesStartDate || form.seriesEndDate) && (
                        <FieldRow label="유효 기간" lined>
                          <div className={styles.seriesCard}>
                            <span className={styles.seriesCardIcon}>📅</span>
                            <span>{form.seriesStartDate}</span>
                            <span className={styles.seriesCardArrow}>→</span>
                            {form.repeatEndType === 'date' && form.repeatEndDate
                              ? <span>{form.repeatEndDate}</span>
                              : <span className={styles.seriesCardInfinity}>무기한</span>
                            }
                          </div>
                        </FieldRow>
                      )}
                    </div>
                  )}

                  {/* === interval 모드 보기 === */}
                  {form.scheduleMode === 'interval' && (
                    <div className={styles.timeCardWrap}>
                      {/* 활동 시간대 */}
                      <div className={styles.timeCard}>
                        <div className={`${styles.timeCardIcon} ${styles.timeCardIconInterval}`}>⏳</div>
                        <div className={styles.timeCardBody}>
                          <span className={styles.timeCardLabel}>활동 시간대</span>
                          <span className={styles.timeCardValue}>
                            {form.activeStartTime} ~ {form.activeEndTime}
                          </span>
                          <span className={styles.timeCardSub}>
                            매 {form.intervalMinutes ?? 0}분 간격 실행
                          </span>
                        </div>
                      </div>
                      {/* 반복 요일 */}
                      {form.intervalRepeatDays.length > 0 && (
                        <FieldRow label="반복 요일" lined>
                          <div className={styles.dowChips}>
                            {(['월','화','수','목','금','토','일'] as const).map((d) => (
                              <span key={d} className={`${styles.dowChip} ${form.intervalRepeatDays.includes(d) ? styles.dowChipActiveInterval : ''}`}>
                                {d}
                              </span>
                            ))}
                          </div>
                        </FieldRow>
                      )}
                      {/* 유효 기간 */}
                      {(form.seriesStartDate || form.seriesEndDate) && (
                        <FieldRow label="유효 기간" lined>
                          <div className={styles.seriesCard}>
                            <span className={styles.seriesCardIcon}>📅</span>
                            <span>{form.seriesStartDate}</span>
                            <span className={styles.seriesCardArrow}>→</span>
                            {form.repeatEndType === 'date' && form.repeatEndDate
                              ? <span>{form.repeatEndDate}</span>
                              : <span className={styles.seriesCardInfinity}>무기한</span>
                            }
                          </div>
                        </FieldRow>
                      )}
                    </div>
                  )}
                </>
              )}
                {isEditMode && (fieldErrors.dateTime || fieldErrors.pastDate) && (
                  <div style={{ marginBottom: 8 }}>
                    <span className={styles.fieldError}>{fieldErrors.dateTime || fieldErrors.pastDate}</span>
                  </div>
                )}
            </div>

            {/* === 상태 섹션 === */}
            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>상태<span className={styles.detailSectionLine} /></div>

            <FieldRow label="작업상태" lined>
            {isEditMode ? (
                <SharedCustomSelect
                  placeholder="작업상태를 선택하세요"
                  value={WORK_STATUS.find(s => s.label === form.workStatus) ?? null}
                  options={WORK_STATUS}
                  onChange={(opt) => setForm((p) => ({ ...p, workStatus: opt.label }))}
                  error={!!fieldErrors.workStatus}
                />
            ) : (
                <span className={`${styles.detailStatusBadge} ${
                    form.workStatus === '대기' ? styles.detailStatusYellow
                    : form.workStatus === '진행중' || form.workStatus === '진행' ? styles.detailStatusBlue
                    : form.workStatus === '완료' ? styles.detailStatusGreen
                    : form.workStatus === '오류' ? styles.detailStatusRed
                    : form.workStatus === '취소' ? styles.detailStatusOrange
                    : ''
                  }`}>
                  {form.workStatus}
                </span>
            )}
            </FieldRow>
            {isEditMode && fieldErrors.workStatus && (
              <span className={styles.fieldError}>{fieldErrors.workStatus}</span>
            )}

            {/* 반복설정은 일시 섹션의 3모드 UI로 통합됨 */}

            </div>

            {/* === 경로 섹션 === */}
            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>경로 정보<span className={styles.detailSectionLine} /></div>

                <FieldRow label="작업경로" lined>
                {isEditMode ? (
                    <SharedCustomSelect
                      placeholder="작업경로를 선택하세요"
                      value={pathOptions.find(p => p.label === form.pathName) ?? null}
                      options={pathOptions}
                      onChange={(opt) => {
                        const matched = pathOptions.find(p => p.id === opt.id);
                        setForm((prev) => ({
                          ...prev,
                          pathId: opt.id as number,
                          pathName: opt.label,
                          pathOrder: (matched as any)?.order ?? "",
                        }));
                      }}
                      emptyMessage="등록된 경로가 없습니다"
                      error={!!fieldErrors.pathName}
                      overlay
                    />
                ) : (
                    <ViewText value={form.pathName} />
                )}
                </FieldRow>
                {isEditMode && fieldErrors.pathName && (
                  <span className={styles.fieldError}>{fieldErrors.pathName}</span>
                )}

                <FieldRow label="경로순서" lined>
                  {form.pathOrder ? (
                    <div className={styles.pathSteps}>
                      {form.pathOrder.split(" - ").map((place, i, arr) => (
                        <React.Fragment key={i}>
                          <span className={styles.pathStep}>
                            <span className={styles.pathStepDot}>{i + 1}</span>
                            <span className={styles.pathStepName}>{place.trim()}</span>
                          </span>
                          {i < arr.length - 1 && <span className={styles.pathStepArrow}>→</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.detailPathOrder}>-</div>
                  )}
                </FieldRow>

                {isEditMode && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14, marginBottom: 14 }}>
                    <button
                      type="button"
                      className={styles.detailLinkBtn}
                      onClick={() => router.push('/mapManagement?tab=path')}
                    >
                      경로 관리 탭으로 이동 →
                    </button>
                  </div>
                )}

                {!isEditMode && modifiedAtText && (
                  <FieldRow label="수정 일시" lined>
                    <ViewText value={modifiedAtText} />
                  </FieldRow>
                )}
            </div>
          </div>}

          {/* 에러 확인창 */}

          {/* 하단 버튼 */}
          {!loading && <div className={styles.btnTotal}>
            <div className={styles.btnLeftBox}>
              {mode === 'view' ? (
                <>
                  <button
                    type="button"
                    className={`${styles.btnItemCommon} ${styles.btnBgRed} `}
                    onClick={handleDelete}
                  >
                    <img src="/icon/delete_icon.png" alt="delete" />
                    <span>삭제</span>
                  </button>

                  <button
                    type="button"
                    className={`${styles.btnItemCommon} ${styles.btnBgGray}`}
                    onClick={handleEditStart}
                  >
                    <img src="/icon/edit_icon.png" alt="edit" />
                    <span>수정</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={`${styles.btnItemCommon} ${styles.btnBgGray} `}
                    onClick={handleEditCancel}
                  >
                    <img src="/icon/close_btn.png" alt="cancel" />
                    <span>취소</span>
                  </button>

                  <button
                    type="button"
                    className={`${styles.btnItemCommon} ${styles.btnBgBlue} ${saving ? styles.btnDisabled : ''}`}
                    onClick={saving ? undefined : handleEditSave}
                  >
                    <img src="/icon/check.png" alt="save" />
                    <span>{saving ? '저장 중...' : '저장'}</span>
                  </button>
                </>
              )}
            </div>
          </div>}
        </div>
      </div>

      {/* 삭제 확인 */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          message="해당 작업일정을 삭제하시겠습니까?"
          onConfirm={handleDeleteConfirm}
          onCancel={handleDeleteCancel}
        />
      )}

      {/* 반복 작업 수정/삭제 범위 선택 모달 */}
      {repeatConfirmOpen && (
        <RepeatConfirmModal
          isOpen={repeatConfirmOpen}
          mode={repeatConfirmMode}
          defaultScope={repeatConfirmMode === "edit" ? "thisAndFuture" : "this"}
          onClose={handleRepeatConfirmCancel}
          onCancel={handleRepeatConfirmCancel}
          onConfirm={handleRepeatConfirmOk}
        />
      )}

      {/* 미저장 변경사항 확인 모달 */}
      {showDirtyConfirm && (
        <div className={styles.confirmOverlay} onClick={() => setShowDirtyConfirm(false)}>
          <div className={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
            <p>수정 중인 내용이 있습니다.<br />닫으시겠습니까?</p>
            <div className={styles.confirmBtnGroup}>
              <button className={styles.confirmBtnStay} onClick={() => setShowDirtyConfirm(false)}>
                계속 수정
              </button>
              <button className={styles.confirmBtnLeave} onClick={handleDirtyConfirmLeave}>
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
