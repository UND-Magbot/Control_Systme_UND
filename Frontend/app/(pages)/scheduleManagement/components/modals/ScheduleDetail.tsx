'use client';

import styles from '../ScheduleCrud.module.css';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useRouter } from 'next/navigation';
import DeleteConfirmModal from '@/app/components/modal/CancelConfirmModal';
import RepeatConfirmModal, { type RepeatConfirmMode, type RepeatConfirmScope } from '@/app/(pages)/scheduleManagement/components/modals/RepeatConfirmModals';
import MiniCalendar from '../widgets/MiniCalendar';
import DateField from '../widgets/DateField';
import { apiFetch } from "@/app/lib/api";
import { WORK_TYPES, WORK_TYPE_ALL, resolveTaskTypeLabel, WORK_STATUS, DOWS as DOWS_CONST, SCHEDULE_MODE_LABELS, INTERVAL_PRESETS, AMPM_OPTIONS, HOUR_OPTIONS, MINUTE_OPTIONS, type ScheduleMode, type Dow } from '../../constants';
import { isRecurringSeries } from '@/app/lib/scheduleMode';
import { getByteLength } from '../../utils/validation';
import { extractOriginalId } from '../../utils/expandRepeatSchedules';
import { pad2, formatDate, minToHm, hmToMin, toAmpmHour, fromAmpmHour } from '../../utils/datetime';
import { resolveOccurrenceStatus, isFutureOccurrence } from '@/app/lib/occurrenceStatus';
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
  /** 'this'/'thisAndFuture' 범위 편집 기준일 (YYYY-MM-DD). 미지정 시 오늘로 처리. */
  targetDate?: string;
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
  onScheduleChanged?: () => Promise<void> | void;
};

type SelectOption = { id: number; label: string; order?: string; taskType?: string; };




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
  targetDate,
  mockData,
  onUpdate,
  onDelete,
  onScheduleChanged,
}: ScheduleDetailProps) {
  const router = useRouter();
    const dbId = extractOriginalId(event.id);
    const [mode, setMode] = useState<Mode>('view');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    // 작업 취소(= 이 회차만 실행 안 함). 편집 취소와 이름이 겹치므로 변수명을 work* 로 구분한다.
    const [showWorkCancelConfirm, setShowWorkCancelConfirm] = useState(false);
    const [workCancelling, setWorkCancelling] = useState(false);
    // 작업 재개(= '오류'로 멈춘 것을 다시 실행 대상으로)
    const [showResumeConfirm, setShowResumeConfirm] = useState(false);
    const [resuming, setResuming] = useState(false);
    const [repeatConfirmOpen, setRepeatConfirmOpen] = useState(false);
    const [repeatConfirmMode, setRepeatConfirmMode] = useState<RepeatConfirmMode>("delete");
    const [repeatScope, setRepeatScope] = useState<RepeatConfirmScope>("this");
    const [showDirtyConfirm, setShowDirtyConfirm] = useState(false);
    const [dirtyAction, setDirtyAction] = useState<'cancel' | 'close'>('cancel');
    const [siblingCount, setSiblingCount] = useState(0);
    // 회차가 여럿인 시리즈인가 — 하루짜리면 범위 선택을 묻지 않는다
    const [isRecurring, setIsRecurring] = useState(false);
    // 진행 중·완료·취소라 수정할 수 없을 때 뜨는 안내(삭제·작업 취소로 유도)
    const [showEditBlocked, setShowEditBlocked] = useState(false);
    const [showMergeWarning, setShowMergeWarning] = useState(false);
    const [mergeWarningFor, setMergeWarningFor] = useState<RepeatConfirmMode>('edit');
    const [mergeWarningScope, setMergeWarningScope] = useState<RepeatConfirmScope>('all');

    const [modifiedAtText, setModifiedAtText] = useState<string | null>(null);

    const [initialForm, setInitialForm] = useState<FormState>(() => buildInitialForm(event));
    const [form, setForm] = useState<FormState>(initialForm);

    const [startDateText, setStartDateText] = useState(formatDate(new Date()));
    const [endDateText, setEndDateText] = useState(formatDate(new Date()));

    // 모달 열림 또는 다른 이벤트로 전환 시에만 초기화.
    // deps를 [isOpen, event.id]로 고정해서, fallback useEffect가 initialForm을 업데이트해도
    // 편집 모드가 강제 view로 돌아가지 않도록 함.
    useEffect(() => {
        if (!isOpen) return;
        const initial = buildInitialForm(event);
        setInitialForm(initial);
        setForm(initial);
        setMode('view');
        setShowDeleteConfirm(false);
        const normalized = formatDate(parseDateText(initial.dateText));
        setStartDateText(normalized);
        setEndDateText(normalized);
        setIsStartDateOpen(false);
        setIsEndDateOpen(false);
        setIsRepeatEndDateOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, event.id]);

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
    // form.workStatus 는 **원본 시리즈 row** 의 상태다. 이 모달은 특정 회차(targetDate)를
    // 열어 놓고 보는 화면이라, 캘린더와 같은 규칙으로 회차 상태를 다시 판정해야 한다.
    // 안 그러면 캘린더는 '대기'인데 상세는 '진행중'인 모순이 생긴다.
    const occurrenceStatus = resolveOccurrenceStatus(form.workStatus, targetDate ?? null);
    const isFuture = isFutureOccurrence(targetDate ?? null);

    // 수정 차단 판정. 서버(_edit_block_reason)와 같은 기준을 화면에서도 쓴다.
    // 오늘 이미 실행됐어도 지금 '대기'면 허용한다 — 내일 이후 회차는 고칠 수 있어야 한다.
    const editBlockReason: string | null = (() => {
      const s = form.workStatus;
      if (s === '완료' || s === '취소') {
        return `'${s}' 상태의 작업은 수정할 수 없습니다.`;
      }
      if ((s === '진행중' || s === '진행') && !isFuture) {
        return '진행 중인 작업은 수정할 수 없습니다.';
      }
      return null;
    })();

    // 범위(이 회차/이후 모든/전체)를 물어야 하는가.
    // 반복 모드라도 하루짜리 시리즈면 세 선택지가 같은 뜻이라 묻지 않고 바로 진행한다.
    const needsScopeChoice = form.repeatEnabled && isRecurring;

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
      // 지나간 것(완료·취소)과 지금 도는 것(진행중)은 고칠 수 없다 — 서버도 409로 막는다.
      if (editBlockReason) {
        setShowEditBlocked(true);
        return;
      }
      // 회차가 여럿인 반복 작업이면: 범위 선택 모달 먼저
      if (needsScopeChoice) {
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
        disabled: repeatConfirmOpen || showDeleteConfirm || showDirtyConfirm || showMergeWarning,
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
        // 작업상태는 수정 모달에서 UI 숨김 처리됨 — validation 생략 (DB에서 받은 기존 값 유지)
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

        // 전체 수정(all) 에서는 유효기간 필드가 UI 에 없으므로 검증도 생략
        const skipValidityPeriod = repeatScope === 'all';

        if (form.scheduleMode === 'weekly') {
            if (form.repeatDays.length === 0) errors.repeatDays = "반복요일을 최소 1일 선택하세요.";
            if (!skipValidityPeriod && form.repeatEndType === "date" && form.repeatEndDate && form.seriesStartDate) {
                if (form.repeatEndDate < form.seriesStartDate) {
                    errors.seriesEndDate = "종료일이 시작일보다 빠릅니다.";
                }
            }
        }

        if (form.scheduleMode === 'interval') {
            if (!form.intervalMinutes || form.intervalMinutes < 1) {
                errors.intervalMinutes = "반복 간격을 1분 이상 입력하세요.";
            }
            if (!skipValidityPeriod && form.repeatEndType === "date" && form.repeatEndDate && form.seriesStartDate) {
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

        // TaskStatus는 수정 모달에서 변경 허용 안 하므로 페이로드 제외 → 서버의 기존 값 유지
        const payload: Record<string, any> = {
            id: event.id,
            WorkName: form.title,
            TaskType: form.workType,
            ScheduleMode: form.scheduleMode,
            PathName: form.pathName,
            ...(repeatScope ? { RepeatScope: repeatScope, TargetDate: targetDate } : {}),
        };

        // 전체 수정 범위에서는 유효기간을 클라이언트가 지정하지 않음.
        // 서버의 "all" 분기가 그룹의 최광역 범위로 자동 조정하므로 페이로드에서 제외.
        const includeValidityPeriod = repeatScope !== 'all';

        if (form.scheduleMode === 'once') {
            payload.StartTime = startDT;
        } else if (form.scheduleMode === 'weekly') {
            payload.ExecutionTime = form.executionTimes.length > 0
              ? form.executionTimes.join(",")
              : `${pad2(fromAmpmHour(form.startAmpm, form.startHour))}:${pad2(form.startMin)}`;
            payload.RepeatDays = form.repeatDays.join(",");
            if (includeValidityPeriod) {
                payload.SeriesStartDate = form.seriesStartDate || startDateText;
                payload.SeriesEndDate = form.repeatEndType === "date" ? form.repeatEndDate : null;
            }
        } else if (form.scheduleMode === 'interval') {
            payload.ActiveStartTime = form.activeStartTime;
            payload.ActiveEndTime = form.activeEndTime;
            payload.IntervalMinutes = form.intervalMinutes;
            payload.RepeatDays = form.intervalRepeatDays.length ? form.intervalRepeatDays.join(",") : null;
            if (includeValidityPeriod) {
                payload.SeriesStartDate = form.seriesStartDate || startDateText;
                payload.SeriesEndDate = form.repeatEndType === "date" ? form.repeatEndDate : null;
            }
        } else if (form.scheduleMode === 'standby') {
            // 운영 시간대·요일·유효기간만 보낸다. 호출 방식·대기 장소 등 Standby* 설정은
            // 이 모달이 다루지 않으므로 페이로드에서 빼 서버의 기존 값을 유지시킨다.
            payload.ActiveStartTime = form.activeStartTime;
            payload.ActiveEndTime = form.activeEndTime;
            payload.RepeatDays = form.intervalRepeatDays.length ? form.intervalRepeatDays.join(",") : null;
            if (includeValidityPeriod) {
                payload.SeriesStartDate = form.seriesStartDate || startDateText;
                payload.SeriesEndDate = form.repeatEndType === "date" ? form.repeatEndDate : null;
            }
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
            await onScheduleChanged?.();
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

    // ── 작업 취소 ─────────────────────────────────────────────
    // **지금 돌고 있는 작업을 멈추는 것**만 취소로 남긴다.
    //
    // 아직 오지 않은 회차를 건너뛰는 일은 '삭제(이 회차)'가 이미 한다 —
    // 서버가 두 경로 모두 SeriesExceptions 에 그날을 넣는 같은 방식이라,
    // 같은 일을 하는 버튼을 둘 두면 무엇을 눌러야 할지만 헷갈린다.
    // (차이는 달력에 '취소'로 남기느냐 지우느냐뿐이다.)
    const isTodayOccurrence = !targetDate || targetDate === formatDate(new Date());
    const canCancelWork = isTodayOccurrence
        && (occurrenceStatus === '진행중' || occurrenceStatus === '진행');

    const handleWorkCancelConfirm = async () => {
        setWorkCancelling(true);
        try {
            const res = await apiFetch(`/DB/schedule/${dbId}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(targetDate ? { TargetDate: targetDate } : {}),
            });
            if (!res.ok) {
                // 이미 완료·취소된 작업이면 409 로 사유가 온다 — 그대로 보여준다.
                let msg = "작업 취소에 실패했습니다.";
                try { msg = (await res.json())?.detail || msg; } catch { /* 본문 없음 */ }
                throw new Error(msg);
            }
            await onScheduleChanged?.();
            setShowWorkCancelConfirm(false);
            onClose();
        } catch (e) {
            console.error("작업 취소 실패", e);
            setApiError(e instanceof Error ? e.message : "작업 취소에 실패했습니다.");
            setShowWorkCancelConfirm(false);
        } finally {
            setWorkCancelling(false);
        }
    };

    // ── 작업 재개 ─────────────────────────────────────────────
    // 서버 재기동 등 외부 요인으로 끊긴 작업은 '오류'로 남고 스케줄러가 집어가지 않는다.
    // 재기동 시점의 로봇 위치를 모르는 채 자동 재개하면 위험해서, 사람이 눌러 되돌린다.
    const canResumeWork = occurrenceStatus === '오류';

    const handleResumeConfirm = async () => {
        setResuming(true);
        try {
            const res = await apiFetch(`/DB/schedule/${dbId}/resume`, { method: "POST" });
            const body = await res.json().catch(() => null);
            if (!res.ok) throw new Error(body?.detail || "작업 재개에 실패했습니다.");
            await onScheduleChanged?.();
            setShowResumeConfirm(false);
            onClose();
        } catch (e) {
            console.error("작업 재개 실패", e);
            setApiError(e instanceof Error ? e.message : "작업 재개에 실패했습니다.");
            setShowResumeConfirm(false);
        } finally {
            setResuming(false);
        }
    };

    const handleDelete = () => {
      // ✅ 회차가 여럿인 반복 작업이면: 범위 선택 모달 먼저
      if (needsScopeChoice) {
        openRepeatConfirm("delete");
        return;
      }
      setShowDeleteConfirm(true);
    };

    const [robots, setRobots] = useState<SelectOption[]>([]);
    // RobotName → CurrentFloorId 매핑 (경로 층 필터링용)
    const [robotFloorMap, setRobotFloorMap] = useState<Record<string, number | null>>({});

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
          const floorMap: Record<string, number | null> = {};
          for (const r of list) {
            const name = r.RobotName ?? r.no ?? '';
            if (name) floorMap[name] = r.CurrentFloorId ?? null;
          }
          setRobotFloorMap(floorMap);
        })
        .catch((e) => {
          console.error("로봇 목록 조회 실패", e);
          setRobots([]);
          setRobotFloorMap({});
        });
    }, [isOpen]);

    const [pathOptions, setPathOptions] = useState<SelectOption[]>([]);
    // applyDetailData가 stale closure 없이 최신 pathOptions를 참조할 수 있도록 ref 동기화
    const pathOptionsRef = useRef<SelectOption[]>([]);

   useEffect(() => {
    if (!isOpen) return;

    apiFetch(`/DB/getpath`)
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : (data?.paths ?? []);
        const mapped = list.map((p: any) => {
          let stopActions: ({ announceText?: string | null; confirm?: string } | null)[] | undefined;
          if (p.StopActions) {
            try {
              const parsed = JSON.parse(p.StopActions);
              if (Array.isArray(parsed)) stopActions = parsed;
            } catch {
              stopActions = undefined;
            }
          }
          return {
            id: p.id,
            label: p.WayName,
            order: p.WayPoints ?? "",
            taskType: resolveTaskTypeLabel(p.TaskType),
            floorId: p.FloorId ?? null,
            stopActions,
          };
        });
        pathOptionsRef.current = mapped;
        setPathOptions(mapped);
      })
      .catch((e) => {
        console.error("경로 목록 조회 실패", e);
        pathOptionsRef.current = [];
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

    // ref를 통해 최신 pathOptions 참조 (stale closure 회피).
    // 만약 ref도 비어 있으면(패스 fetch가 더 늦게 끝나는 경우) 아래 fallback useEffect가 이어서 채움.
    const matchedPath = pathOptionsRef.current.find((p) => p.label === data.WayName);
    const startAmpm = startH24 < 12 ? '오전' : '오후';
    const endAmpm = endH24 < 12 ? '오전' : '오후';

    const mode = (data.ScheduleMode || (data.Repeat === "Y" ? "weekly" : "once")) as FormState["scheduleMode"];

    const newForm: FormState = {
      robotNo: data.RobotName,
      title: data.TaskName,
      workType: resolveTaskTypeLabel(data.TaskType),
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
      pathOrder: (matchedPath as any)?.order ?? "",

      scheduleMode: mode,

      // standby 도 시리즈(SeriesGroupId·SeriesExceptions)로 사는 반복 작업이다.
      // 수정·삭제 모두 범위 선택(이 회차/이후/전체)을 거쳐야 한다.
      repeatEnabled: mode === "weekly" || mode === "interval" || mode === "standby",
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
      // standby 도 운영 요일을 Repeat_Day 에 저장한다 — 같은 칩 UI를 쓴다
      intervalRepeatDays: (mode === "interval" || mode === "standby") && data.Repeat_Day
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
        setSiblingCount(Number(data.SiblingCount ?? 0));
        setIsRecurring(isRecurringSeries(data));

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

  // pathOptions 로드 후 경로순서/작업유형 자동 매칭.
  // 의존성에 form.pathOrder / form.workType을 제외해야 사용자가 이후에 비워도
  // 자동 채움이 재트리거되지 않음 (무한 루프/의도 무시 방지).
  // form과 initialForm 둘 다 업데이트해야 dirty check가 오인하지 않음
  // (자동 매칭은 "서버 유도 값" 이지 사용자 편집 아님).
  useEffect(() => {
    if (!isOpen || pathOptions.length === 0 || !form.pathName) return;
    const matched = pathOptions.find((p) => p.label === form.pathName);
    if (!matched) return;
    const pathOrderVal = (matched as any).order as string | undefined;
    const pathTaskType = (matched as any).taskType as string | undefined;

    const applyAutoFill = (prev: FormState): FormState => {
      const next = { ...prev };
      let changed = false;
      if (pathOrderVal && !prev.pathOrder) {
        next.pathOrder = pathOrderVal;
        changed = true;
      }
      if (pathTaskType && !prev.workType) {
        next.workType = pathTaskType;
        changed = true;
      }
      return changed ? next : prev;
    };

    setForm(applyAutoFill);
    setInitialForm(applyAutoFill);
  }, [pathOptions, isOpen, form.pathName]);

  // 작업유형 + 로봇의 현재 층에 맞는 경로만 필터링 (유형 미선택 시 층만 적용).
  // 현재 선택된 경로(form.pathName)는 층/유형과 무관하게 항상 포함 — 사용자가 기존 선택을 확인할 수 있도록.
  const filteredPathOptions = useMemo(() => {
    const robotFloor = form.robotNo ? robotFloorMap[form.robotNo] ?? null : null;
    return pathOptions.filter((p) => {
      if (form.pathName && p.label === form.pathName) return true;
      if (form.workType && (p.taskType ?? "") !== form.workType) return false;
      if (form.robotNo && robotFloor !== null) {
        if ((p as any).floorId !== robotFloor) return false;
      }
      return true;
    });
  }, [pathOptions, form.workType, form.robotNo, form.pathName, robotFloorMap]);

  // 편집 모드에서 작업유형이 변경되어 현재 선택된 경로가 필터에 안 맞으면 초기화
  useEffect(() => {
    if (!isEditMode || !form.pathName || pathOptions.length === 0) return;
    const matches = filteredPathOptions.some((p) => p.label === form.pathName);
    if (!matches) {
      setForm((p) => ({ ...p, pathName: '', pathOrder: '' }));
    }
  }, [isEditMode, form.workType, filteredPathOptions, form.pathName, pathOptions.length]);

    const handleDeleteCancel = () => setShowDeleteConfirm(false);

    const handleDeleteConfirm = async () => {
        try {
            const deletePayload = repeatScope
                ? { RepeatScope: repeatScope, ...(targetDate ? { TargetDate: targetDate } : {}) }
                : {};
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
            await onScheduleChanged?.();
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

    const proceedAfterScopeChosen = (scope: RepeatConfirmScope) => {
      if (repeatConfirmMode === "edit") {
        // thisAndFuture 시: 유효기간 시작일을 클릭한 날짜로 자동 세팅 (혼동 방지)
        if (scope === "thisAndFuture" && targetDate) {
          setForm((p) => ({ ...p, seriesStartDate: targetDate }));
        }
        // this 시: 유효기간 당일~당일로 자동 세팅 (혼동 방지)
        if (scope === "this" && targetDate) {
          setForm((p) => ({
            ...p,
            seriesStartDate: targetDate,
            seriesEndDate: targetDate,
            repeatEndType: 'date',
            repeatEndDate: targetDate,
          }));
        }
        setMode("edit");
        return;
      }

      // delete: 실제 DELETE API를 호출하도록 확인 모달로 이동
      setShowDeleteConfirm(true);
    };

    const handleRepeatConfirmOk = (scope: RepeatConfirmScope) => {
      setRepeatConfirmOpen(false);
      setRepeatScope(scope);

      // 파괴적 범위(all / thisAndFuture) + 분할된 형제 존재 시 경고
      // (this는 SeriesExceptions만 추가하므로 경고 불필요)
      if ((scope === "all" || scope === "thisAndFuture") && siblingCount > 0) {
        setMergeWarningFor(repeatConfirmMode);
        setMergeWarningScope(scope);
        setShowMergeWarning(true);
        return;
      }

      proceedAfterScopeChosen(scope);
    };

    const handleMergeWarningConfirm = () => {
      setShowMergeWarning(false);
      proceedAfterScopeChosen(mergeWarningScope);
    };

    const handleMergeWarningCancel = () => {
      setShowMergeWarning(false);
      // 사용자가 다시 범위를 고를 수 있도록 RepeatConfirm 재오픈
      setRepeatConfirmOpen(true);
    };



    // ===== view helpers =====
    const workTypeTitle = useMemo(() => (form.workType ?? '').replace(' / ', '/'), [form.workType]);

    // 모드별 보기 텍스트
    const viewScheduleModeLabel = form.scheduleMode === 'once' ? '단일 실행'
      : form.scheduleMode === 'weekly' ? '요일 반복'
      : form.scheduleMode === 'standby' ? '상시 대기'
      : '주기 반복';

    const viewTimeText = form.scheduleMode === 'once'
      ? `${startDateText} ${form.startAmpm} ${pad2(form.startHour)}:${pad2(form.startMin)}`
      : form.scheduleMode === 'weekly'
        ? form.executionTimes.length > 0
          ? `매주 ${form.repeatDays.join(',')} ${form.executionTimes.join(', ')}`
          : `매주 ${form.repeatDays.join(',')} ${form.startAmpm} ${pad2(form.startHour)}:${pad2(form.startMin)}`
        : form.scheduleMode === 'standby'
          ? `${form.activeStartTime}~${form.activeEndTime} 호출 대기`
          : `${form.activeStartTime}~${form.activeEndTime} 매 ${form.intervalMinutes ?? 0}분`;

    const viewSeriesText = (form.scheduleMode === 'weekly' || form.scheduleMode === 'interval' || form.scheduleMode === 'standby')
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
              <span className={styles.detailHeaderTitle}>{isEditMode ? '작업 수정' : '작업 상세'}</span>
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
                    value={
                      form.workType
                        ? (WORK_TYPES.find(t => t.label === form.workType) ?? null)
                        : WORK_TYPE_ALL
                    }
                    options={[WORK_TYPE_ALL, ...WORK_TYPES]}
                    onChange={(opt) => setForm((p) => {
                      // "전체" 선택 시 작업유형 초기화 (경로 필터 리셋)
                      if (opt.id === WORK_TYPE_ALL.id) {
                        return { ...p, workType: "" };
                      }
                      const currentPath = pathOptions.find((po) => po.label === p.pathName);
                      const keepPath = currentPath && (currentPath.taskType ?? "") === opt.label;
                      return {
                        ...p,
                        workType: opt.label,
                        pathId: keepPath ? p.pathId : null,
                        pathName: keepPath ? p.pathName : "",
                        pathOrder: keepPath ? p.pathOrder : "",
                      };
                    })}
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
                  {/* 실행 방식 — 상시 대기는 전환 대상이 아니다.
                      대기 장소·호출 방식·목적지 화이트리스트가 이 모달에 없어, 다른 모드로 바꾸면
                      그 설정들이 갈 곳을 잃는다. 읽기전용으로 고정해 전환 자체를 막는다. */}
                  <FieldRow label="실행 방식">
                    {form.scheduleMode === 'standby' ? (
                      <div>
                        <span className={`${styles.modeBadge} ${styles.modeBadgeStandby}`}>
                          <span className={styles.modeBadgeDot} />
                          {SCHEDULE_MODE_LABELS.standby}
                        </span>
                        <div className={styles.standbyHint} style={{ margin: '6px 0 0' }}>
                          호출 방식·대기 장소 등 상시 대기 설정은 이 화면에서 바꿀 수 없습니다.
                        </div>
                      </div>
                    ) : (
                      <div className={styles.modeRadioGroup}>
                        {(['once', 'weekly', 'interval'] as const).map((m) => (
                          <label key={m} className={styles.modeRadioLabel}>
                            <input type="radio" name="editScheduleMode" checked={form.scheduleMode === m}
                              onChange={() => setForm((p) => ({ ...p, scheduleMode: m, repeatEnabled: m !== 'once' }))}
                            />
                            <span>{SCHEDULE_MODE_LABELS[m]}</span>
                          </label>
                        ))}
                      </div>
                    )}
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
                      {repeatScope === 'all' ? (
                        <FieldRow label="유효 기간">
                          <span style={{ color: '#999', fontSize: '0.9em' }}>
                            전체 수정 범위에서는 유효기간이 시리즈 전체 범위로 자동 조정됩니다.
                          </span>
                        </FieldRow>
                      ) : (
                        <FieldRow label="유효 기간">
                          <div className={styles.seriesDateWrap}>
                            <DateField
                              value={form.seriesStartDate}
                              onChange={(v) => setForm((p) => ({ ...p, seriesStartDate: v }))}
                            />
                            <span>~</span>
                            <div className={styles.seriesEndOptions}>
                              <label>
                                <input type="radio" checked={form.repeatEndType === 'none'}
                                  onChange={() => setForm((p) => ({ ...p, repeatEndType: 'none' }))} />
                                무기한
                              </label>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <input type="radio" checked={form.repeatEndType === 'date'}
                                  onChange={() => setForm((p) => ({ ...p, repeatEndType: 'date', repeatEndDate: p.repeatEndDate || formatDate(new Date()) }))} />
                                <DateField
                                  value={form.repeatEndDate}
                                  onChange={(v) => setForm((p) => ({ ...p, repeatEndDate: v }))}
                                  minDate={form.seriesStartDate}
                                  disabled={form.repeatEndType !== 'date'}
                                />
                              </label>
                            </div>
                          </div>
                        </FieldRow>
                      )}
                      {fieldErrors.seriesEndDate && <span className={styles.fieldError}>{fieldErrors.seriesEndDate}</span>}
                    </>
                  )}

                  {/* === interval: 활동시간 + 간격 + 요일 + 유효기간 === */}
                  {/* interval·standby 는 둘 다 운영 시간대로 사는 모드라 폼을 공유한다.
                      standby 는 '반복 간격'만 없다. */}
                  {(form.scheduleMode === 'interval' || form.scheduleMode === 'standby') && (
                    <>
                      <div className={styles.detailDateRow}>
                        <div className={styles.detailFieldLabel}>
                          {form.scheduleMode === 'standby' ? '운영 시작' : '활동 시작'}
                        </div>
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
                        <div className={styles.detailFieldLabel}>
                          {form.scheduleMode === 'standby' ? '운영 종료' : '활동 종료'}
                        </div>
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
                      {/* 반복 간격은 주기 반복 전용 — 상시 대기는 호출이 트리거라 간격 개념이 없다 */}
                      {form.scheduleMode === 'interval' && (
                        <>
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
                        </>
                      )}
                      <FieldRow label={form.scheduleMode === 'standby' ? '운영 요일' : '반복 요일'}>
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
                      {repeatScope === 'all' ? (
                        <FieldRow label="유효 기간">
                          <span style={{ color: '#999', fontSize: '0.9em' }}>
                            전체 수정 범위에서는 유효기간이 시리즈 전체 범위로 자동 조정됩니다.
                          </span>
                        </FieldRow>
                      ) : (
                        <FieldRow label="유효 기간">
                          <div className={styles.seriesDateWrap}>
                            <DateField
                              value={form.seriesStartDate}
                              onChange={(v) => setForm((p) => ({ ...p, seriesStartDate: v }))}
                            />
                            <span>~</span>
                            <div className={styles.seriesEndOptions}>
                              <label>
                                <input type="radio" checked={form.repeatEndType === 'none'}
                                  onChange={() => setForm((p) => ({ ...p, repeatEndType: 'none' }))} />
                                무기한
                              </label>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <input type="radio" checked={form.repeatEndType === 'date'}
                                  onChange={() => setForm((p) => ({ ...p, repeatEndType: 'date', repeatEndDate: p.repeatEndDate || formatDate(new Date()) }))} />
                                <DateField
                                  value={form.repeatEndDate}
                                  onChange={(v) => setForm((p) => ({ ...p, repeatEndDate: v }))}
                                  minDate={form.seriesStartDate}
                                  disabled={form.repeatEndType !== 'date'}
                                />
                              </label>
                            </div>
                          </div>
                        </FieldRow>
                      )}
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
                      : form.scheduleMode === 'standby' ? styles.modeBadgeStandby
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

                  {/* === standby 모드 보기 — 실행 시각이 아니라 운영 시간대가 수명이다 === */}
                  {form.scheduleMode === 'standby' && (
                    <div className={styles.timeCardWrap}>
                      <div className={styles.timeCard}>
                        <div className={`${styles.timeCardIcon} ${styles.timeCardIconInterval}`}>🎧</div>
                        <div className={styles.timeCardBody}>
                          <span className={styles.timeCardLabel}>운영 시간대</span>
                          <span className={styles.timeCardValue}>
                            {form.activeStartTime} ~ {form.activeEndTime}
                          </span>
                          <span className={styles.timeCardSub}>이 시간대에 대기 장소에서 호출을 기다립니다</span>
                        </div>
                      </div>
                      {form.intervalRepeatDays.length > 0 && (
                        <FieldRow label="운영 요일" lined>
                          <div className={styles.dowChips}>
                            {(['월','화','수','목','금','토','일'] as const).map((d) => (
                              <span key={d} className={`${styles.dowChip} ${form.intervalRepeatDays.includes(d) ? styles.dowChipActiveInterval : ''}`}>
                                {d}
                              </span>
                            ))}
                          </div>
                        </FieldRow>
                      )}
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

            {/* === 상태 섹션 === 편집 모드에서는 섹션 전체 숨김 (상태 변경은 테스트용이며, 일반 사용자에겐 혼란 유발 가능) */}
            {!isEditMode && (
              <div className={styles.detailSection}>
                <div className={styles.detailSectionTitle}>상태<span className={styles.detailSectionLine} /></div>

                {/* 시리즈 원본이 아니라 **지금 열어 본 회차**의 상태다 — 캘린더와 같은 규칙 */}
                <FieldRow label="작업상태" lined>
                  <span className={`${styles.detailStatusBadge} ${
                      occurrenceStatus === '대기' ? styles.detailStatusYellow
                      : occurrenceStatus === '진행중' || occurrenceStatus === '진행' ? styles.detailStatusBlue
                      : occurrenceStatus === '완료' ? styles.detailStatusGreen
                      : occurrenceStatus === '오류' ? styles.detailStatusRed
                      : occurrenceStatus === '취소' ? styles.detailStatusOrange
                      : ''
                    }`}>
                    {occurrenceStatus}
                  </span>
                </FieldRow>
              </div>
            )}

            {/* === 경로 섹션 === */}
            <div className={styles.detailSection}>
              <div className={styles.detailSectionTitle}>경로 정보<span className={styles.detailSectionLine} /></div>

                <FieldRow label="작업경로" lined>
                {isEditMode ? (
                    <SharedCustomSelect
                      placeholder="작업경로를 선택하세요"
                      value={filteredPathOptions.find(p => p.label === form.pathName) ?? null}
                      options={filteredPathOptions}
                      onChange={(opt) => {
                        const matched = filteredPathOptions.find(p => p.id === opt.id);
                        const fullMatched = pathOptions.find(p => p.id === opt.id);
                        setForm((prev) => ({
                          ...prev,
                          pathId: opt.id as number,
                          pathName: opt.label,
                          pathOrder: (matched as any)?.order ?? "",
                          // 작업유형이 비어있으면 경로의 taskType으로 자동 채움
                          workType: prev.workType || ((fullMatched as any)?.taskType ?? ""),
                        }));
                      }}
                      emptyMessage={form.workType ? "해당 작업유형의 경로가 없습니다" : "등록된 경로가 없습니다"}
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

                {/* 도착 안내 미리보기 (읽기 전용) — 해당 경로에 발화가 설정된 경우만 */}
                {(() => {
                  const matched = pathOptions.find((p) => p.label === form.pathName) as
                    | (SelectOption & { stopActions?: ({ announceText?: string | null; confirm?: string } | null)[] })
                    | undefined;
                  const actions = matched?.stopActions ?? [];
                  const names = (form.pathOrder || '').split(' - ').map((s) => s.trim());
                  const hasAnnounce = actions.some((a) => a && (a.announceText || '').trim());
                  if (!hasAnnounce) return null;
                  const cfLabel: Record<string, string> = { button: '버튼', voice: '음성', gesture: '제스처' };
                  return (
                    <FieldRow label="도착 안내" lined>
                      <div style={{ width: '100%', border: '1px solid rgba(146,212,244,.22)', background: 'rgba(146,212,244,.05)', borderRadius: 8, padding: '8px 12px' }}>
                        {names.map((nm, i) => {
                          const a = actions[i];
                          const text = a && (a.announceText || '').trim();
                          if (!text) return null;
                          const cf = a?.confirm && a.confirm !== 'none' ? (cfLabel[a.confirm] ?? a.confirm) : null;
                          return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12, color: '#cfd6e6' }}>
                              <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#3B415F', color: '#cfd6e6', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                              <span style={{ width: 90, flexShrink: 0, color: '#9DADCB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nm}>{nm}</span>
                              <span style={{ flex: 1, minWidth: 0, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={text}>&ldquo;{text}&rdquo;</span>
                              {cf && <span style={{ fontSize: 11, color: '#dceeff', background: '#2568a8', borderRadius: 4, padding: '1px 8px', flexShrink: 0 }}>확인: {cf}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </FieldRow>
                  );
                })()}

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

                  {/* 외부 요인(서버 재기동 등)으로 멈춘 작업만 — 자동 재개는 하지 않는다 */}
                  {canResumeWork && (
                    <button
                      type="button"
                      className={`${styles.btnItemCommon} ${styles.btnBgBlue}`}
                      onClick={() => setShowResumeConfirm(true)}
                    >
                      <img src="/icon/check.png" alt="resume" />
                      <span>작업 재개</span>
                    </button>
                  )}

                  {/* 지금 돌고 있는 작업에만 — 미래 회차 건너뛰기는 삭제(이 회차)가 한다 */}
                  {canCancelWork && (
                    <button
                      type="button"
                      className={`${styles.btnItemCommon} ${styles.btnBgGray}`}
                      onClick={() => setShowWorkCancelConfirm(true)}
                    >
                      <img src="/icon/close_btn.png" alt="stop-work" />
                      {/* '취소'는 미래 회차 건너뛰기로 읽힌다 — 이 버튼은 지금 돌고 있는 걸 멈춘다 */}
                      <span>작업 중단</span>
                    </button>
                  )}

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

      {/* 작업 취소 확인 — 삭제와 헷갈리지 않게 "일정은 남는다"를 명시한다 */}
      {showWorkCancelConfirm && (
        <DeleteConfirmModal
          message={
            // 이 버튼은 이제 '지금 돌고 있는 작업 중단'에만 뜬다(미래 회차는 삭제로 처리).
            form.scheduleMode !== 'once'
              ? "진행 중인 작업을 중단하시겠습니까? 로봇이 즉시 정지하며, 일정은 삭제되지 않고 다음 회차는 그대로 실행됩니다."
              : "진행 중인 작업을 중단하시겠습니까? 로봇이 즉시 정지하며, 일정은 삭제되지 않습니다."
          }
          onConfirm={workCancelling ? () => {} : handleWorkCancelConfirm}
          onCancel={() => setShowWorkCancelConfirm(false)}
        />
      )}

      {/* 작업 재개 확인 — 로봇이 실제로 움직이므로 무엇이 일어나는지 먼저 말한다 */}
      {showResumeConfirm && (
        <DeleteConfirmModal
          message={
            form.scheduleMode === 'standby'
              ? "작업을 재개하시겠습니까? 운영 시간대가 남아 있으면 오늘 근무를 이어받고, 로봇이 대기 장소로 돌아간 뒤 호출을 기다립니다."
              : "작업을 재개하시겠습니까? 다시 자동 실행 대상이 됩니다."
          }
          onConfirm={resuming ? () => {} : handleResumeConfirm}
          onCancel={() => setShowResumeConfirm(false)}
        />
      )}

      {/* 수정 불가 안내 — 막고 끝내지 않고 할 수 있는 일(삭제·작업 취소)로 보낸다 */}
      {showEditBlocked && (
        <div className={styles.confirmOverlay} onClick={() => setShowEditBlocked(false)}>
          <div className={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
            <p>
              {editBlockReason}
              <br />
              {canCancelWork
                ? '삭제하거나, 진행 중인 작업을 중단할 수 있습니다.'
                : '삭제만 가능합니다.'}
            </p>
            <div className={styles.confirmBtnGroup}>
              <button className={styles.confirmBtnStay} onClick={() => setShowEditBlocked(false)}>
                닫기
              </button>
              {canCancelWork && (
                <button
                  className={styles.confirmBtnStay}
                  onClick={() => { setShowEditBlocked(false); setShowWorkCancelConfirm(true); }}
                >
                  작업 취소
                </button>
              )}
              <button
                className={styles.confirmBtnLeave}
                onClick={() => { setShowEditBlocked(false); handleDelete(); }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
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

      {/* 파괴적 범위(all / thisAndFuture) 편집·삭제 시 개별 수정 회차 덮어쓰기 경고 */}
      {showMergeWarning && (
        <div className={styles.confirmOverlay} onClick={handleMergeWarningCancel}>
          <div className={styles.confirmBox} onClick={(e) => e.stopPropagation()}>
            <p>
              {mergeWarningScope === "all"
                ? (mergeWarningFor === "edit"
                    ? `이 시리즈의 개별 수정 회차 ${siblingCount}개가 모두 덮어씌워집니다.`
                    : `이 시리즈의 개별 수정 회차 ${siblingCount}개도 함께 삭제됩니다.`)
                : (mergeWarningFor === "edit"
                    ? "오늘 이후에 개별 수정된 회차는 이 수정으로 덮어씌워집니다."
                    : "오늘 이후에 개별 수정된 회차도 함께 삭제됩니다.")}
              <br />
              계속하시겠습니까?
            </p>
            <div className={styles.confirmBtnGroup}>
              <button className={styles.confirmBtnStay} onClick={handleMergeWarningCancel}>
                취소
              </button>
              <button className={styles.confirmBtnLeave} onClick={handleMergeWarningConfirm}>
                계속
              </button>
            </div>
          </div>
        </div>
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
