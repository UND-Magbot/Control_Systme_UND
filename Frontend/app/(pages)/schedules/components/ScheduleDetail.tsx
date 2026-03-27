'use client';

import styles from './ScheduleCrud.module.css';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { useRouter } from 'next/navigation';
import DeleteConfirmModal from '@/app/components/modal/CancelConfirmModal';
import RepeatConfirmModal, { type RepeatConfirmMode, type RepeatConfirmScope } from '@/app/(pages)/schedules/components/RepeatConfirmModals';
import MiniCalendar from './MiniCalendar';
import { getApiBase } from "@/app/config";
import { WORK_TYPES, WORK_STATUS } from '../constants';
import { getByteLength } from '../utils/validation';
import SharedCustomSelect, { type SelectOption as SharedSelectOption } from '@/app/components/select/CustomSelect';


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
    color?: 'green' | 'yellow' | 'blue' | 'red';
  };
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

function CustomSelect({
  placeholder,
  value,
  options,
  isOpen,
  setIsOpen,
  onSelect,
  wrapperRef,
  scrollRef,
  trackRef,
  thumbRef,
}: {
  placeholder: string;
  value: string | null;
  options: SelectOption[];
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSelect: (opt: SelectOption) => void;

  wrapperRef: React.RefObject<HTMLDivElement>;
  scrollRef: React.RefObject<HTMLDivElement>;
  trackRef: React.RefObject<HTMLDivElement>;
  thumbRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={wrapperRef} className={styles.editSeletWrapper}>
      <div
        className={styles.itemSelectBox}
        onClick={() => setIsOpen((v) => !v)}
        role="button"
        tabIndex={0}
      >
        <span>{value ?? placeholder}</span>
        <img
          src={isOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
          alt=""
        />
      </div>

      {isOpen && (
        <div className={styles.seletbox}>
          <div ref={scrollRef} className={styles.inner} role="listbox">
            {options.map((opt) => (
              <div
                key={opt.id}
                className={styles.robotsLabel}
                onClick={() => {
                  onSelect(opt);
                  setIsOpen(false);
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>

          <div ref={trackRef} className={styles.scrollTrack}>
            <div ref={thumbRef} className={styles.scrollThumb} />
          </div>
        </div>
      )}
    </div>
  );
}

function HeadlessSelect({
  placeholder,
  value,
  options,
  isOpen,
  setIsOpen,
  onSelect,
  scrollRef,
  trackRef,
  thumbRef,
  triggerClassName,
  menuClassName,
}: {
  placeholder: string;
  value: string | null;
  options: SelectOption[];
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onSelect: (opt: SelectOption) => void;

  scrollRef: React.RefObject<HTMLDivElement>;
  trackRef: React.RefObject<HTMLDivElement>;
  thumbRef: React.RefObject<HTMLDivElement>;

  triggerClassName?: string;
  menuClassName?: string;
}) {
  return (
    <>
      <div
        className={[styles.itemSelectBox, triggerClassName].filter(Boolean).join(" ")}
        onClick={() => setIsOpen((v) => !v)}
        role="button"
        tabIndex={0}
      >
        <span>{value ?? placeholder}</span>
        <img src={isOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
      </div>

      {isOpen && (
        <div className={[styles.seletbox, menuClassName].filter(Boolean).join(" ")}>
          <div ref={scrollRef} className={styles.inner} role="listbox">
            {options.map((opt) => (
              <div
                key={opt.id}
                className={styles.robotsLabel}
                onClick={() => {
                  onSelect(opt);
                  setIsOpen(false);
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>

          <div ref={trackRef} className={styles.scrollTrack}>
            <div ref={thumbRef} className={styles.scrollThumb} />
          </div>
        </div>
      )}
    </>
  );
}



// WorkType, WorkStatus, WORK_TYPES, WORK_STATUS → ../constants.ts 에서 import

const AMPM_OPTIONS = [
  { id: 1, label: "오전" },
  { id: 2, label: "오후" },
];

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  label: String(i + 1).padStart(2, "0"),
}));

const MINUTE_OPTIONS = [0, 10, 20, 30, 40, 50].map((m, i) => ({
  id: i + 1,
  label: String(m).padStart(2, "0"),
}));

const pad2 = (n: number) => String(n).padStart(2, '0');

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function minToHm(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return { h, m };
}

function hmToMin(h: number, m: number) {
  return h * 60 + m;
}

function toAmpmHour(h24: number) {
  const ampm = h24 < 12 ? '오전' : '오후';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { ampm, h12 };
}

function fromAmpmHour(ampm: string, h12: number) {
  // 12AM=0, 12PM=12
  if (ampm === '오전') return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

type Mode = 'view' | 'edit';

type FormState = {
  robotNo: string;
  title: string;
  workType: string; // label
  workStatus: string; // label

  // (목업) 날짜 텍스트. 실제 DatePicker 도입 전까지 문자열로 유지
  dateText: string;
  // (목업) 요일 텍스트. 반복 설정을 실제로 붙이면 구조화 권장
  dowText: string;

  startAmpm: '오전' | '오후';
  startHour: number; // 1-12
  startMin: number; // 0-59

  endAmpm: '오전' | '오후';
  endHour: number; // 1-12
  endMin: number; // 0-59

  // 작업경로
  pathId: number | null;
  pathName: string;
  pathDetails: PathDetail[];
  pathOrder: string;

// 반복 설정
  repeatEnabled: boolean;                 // 반복 / 반복 안함
  repeatDays: Array<'월'|'화'|'수'|'목'|'금'|'토'|'일'>;
  repeatEveryday: boolean;               // 매일 체크
  repeatEndType: 'none' | 'date';        // 없음 / 종료 날짜
  repeatEndDate: string;                 // YYYY-MM-DD
};

// 작업경로(목업)
type PathDetail = {
  order: number;
  label: string;
};

type PathRow = {
  id: number;
  pathName: string;      // 셀렉트에 표시될 경로명
  details: PathDetail[]; // 상세 경로
};

function buildInitialForm(event: ScheduleDetailProps['event']): FormState {
  const start = minToHm(event.startMin);
  const end = minToHm(event.endMin);

  const startA = toAmpmHour(start.h);
  const endA = toAmpmHour(end.h);

  return {
    robotNo: event.robotNo,
    title: event.title,
    workType: event.robotType,
    workStatus: '',

    dateText: '',
    dowText: '',

    startAmpm: startA.ampm as '오전' | '오후',
    startHour: startA.h12,
    startMin: start.m,

    endAmpm: endA.ampm as '오전' | '오후',
    endHour: endA.h12,
    endMin: end.m,

    pathId: null,
    pathName: "",
    pathDetails: [],
    pathOrder: "",

    repeatEnabled: false,
    repeatDays: [],
    repeatEveryday: false,
    repeatEndType: 'none',
    repeatEndDate: '',
  };
}

function formatTimeRangeFromForm(f: FormState) {
  return `${f.startAmpm} ${pad2(f.startHour)}:${pad2(f.startMin)} ~ ${f.endAmpm} ${pad2(
    f.endHour
  )}:${pad2(f.endMin)}`;
}

export default function ScheduleDetail({
  isOpen,
  onClose,
  event,
  onUpdate,
  onDelete,
  onScheduleChanged,
}: ScheduleDetailProps) {
  const router = useRouter();
    const [mode, setMode] = useState<Mode>('view');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [repeatConfirmOpen, setRepeatConfirmOpen] = useState(false);
    const [repeatConfirmMode, setRepeatConfirmMode] = useState<RepeatConfirmMode>("delete");
    const [repeatScope, setRepeatScope] = useState<RepeatConfirmScope>("this");
    const [showDirtyConfirm, setShowDirtyConfirm] = useState(false);
    const [dirtyAction, setDirtyAction] = useState<'cancel' | 'close'>('cancel');

    const [modifiedAtText, setModifiedAtText] = useState<string | null>(null);

    const initialForm = useMemo(() => buildInitialForm(event), [event]);
    const [form, setForm] = useState<FormState>(initialForm);
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

        // 시작/종료 시간 비교
        const startDT = makeDetailDateTime(startDateText, form.startAmpm, form.startHour, form.startMin);
        const endDT = makeDetailDateTime(endDateText, form.endAmpm, form.endHour, form.endMin);
        if (new Date(startDT) >= new Date(endDT)) errors.dateTime = "시작 일시가 종료 일시보다 같거나 늦습니다.";

        // 반복 설정 검증
        if (form.repeatEnabled) {
            if (form.repeatDays.length === 0) errors.repeatDays = "반복요일을 최소 1일 선택하세요.";
            if (form.repeatEndType === "date" && form.repeatEndDate) {
                const repeatEnd = new Date(form.repeatEndDate);
                const startD = new Date(startDateText);
                if (repeatEnd < startD) {
                    errors.repeatEndDate = "반복 종료일이 시작일보다 빠릅니다.";
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

        const payload = {
            id: event.id,
            RobotName: form.robotNo,
            TaskName: form.title,
            TaskType: form.workType,
            TaskStatus: form.workStatus,
            WayName: form.pathName,
            StartTime: startDT,
            EndTime: endDT,
            Repeat: form.repeatEnabled,
            RepeatDays: form.repeatDays.length ? form.repeatDays.join(",") : null,
            RepeatEndDate: form.repeatEndType === "date" ? form.repeatEndDate : null,
            ...(repeatScope ? { RepeatScope: repeatScope } : {}),
        };

        setSaving(true);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`${getApiBase()}/DB/schedule/${event.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!res.ok) throw new Error("수정 실패");
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
                setApiError("스케줄 수정에 실패했습니다.");
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

      fetch(`${getApiBase()}/DB/robots`)
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

    fetch(`${getApiBase()}/DB/getpath`)
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

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);

    fetch(`${getApiBase()}/DB/schedule/${event.id}`)
      .then(res => res.json())
      .then(data => {
        const start = new Date(data.StartDate);
        const end = new Date(data.EndDate);

        const startH24 = start.getHours();
        const endH24 = end.getHours();

        const matchedPath = pathOptions.find(
          (p) => p.label === data.WayName
        );

        const startAmpm = startH24 < 12 ? '오전' : '오후';
        const endAmpm = endH24 < 12 ? '오전' : '오후';

        setForm({
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

          repeatEnabled: Boolean(data.Repeat),
          repeatDays: data.Repeat_Day
            ? data.Repeat_Day.split(",")
            : [],
          repeatEveryday: data.Repeat_Day === '월,화,수,목,금,토,일',
          repeatEndType: data.Repeat_End ? 'date' : 'none',
          repeatEndDate: data.Repeat_End ?? '',
        });

        setStartDateText(formatDate(start));
        setEndDateText(formatDate(end));

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
  }, [isOpen, event.id, pathOptions]);

    const handleDeleteCancel = () => setShowDeleteConfirm(false);

    const handleDeleteConfirm = async () => {
        try {
            const deletePayload = repeatScope ? { RepeatScope: repeatScope } : {};
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`${getApiBase()}/DB/schedule/${event.id}`, {
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
    const workTypeTitle = useMemo(() => form.workType.replace(' / ', '/'), [form.workType]);

    // 상세(보기)에서 보여줄 텍스트는 “form” 기반으로 통일(수정 후 즉시 반영)
    const viewWorkPeriodText = `${form.dateText} - 반복`;
    const viewDowText = form.dowText;
    const viewTimeText = formatTimeRangeFromForm(form);

    // ===== render helpers =====
    const FieldRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
        <div className={styles.itemBox}>
        <div className={styles.itemtitle}>{label}</div>
        {children}
        </div>
    );

    const ViewText = ({ value }: { value: string }) => <div className={styles.itemDetail}>{value}</div>;

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
          <button className={styles.CloseBtn} onClick={handleSafeClose}>
            ✕
          </button>

          {/* 타이틀 */}
          <div className={styles.Title}>
            <div className={styles.TitleCircle}></div>
            <h2>{isEditMode ? '작업 수정' : '작업 상세'}</h2>
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
                  fetch(`${getApiBase()}/DB/schedule/${event.id}`)
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
          {!loading && !fetchError && <div className={styles.itemContainer}>
            {/* === 기본 정보 섹션 === */}
            <FieldRow label="로봇명">
              <ViewText value={form.robotNo}/>
            </FieldRow>

            <FieldRow label="작업명">
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
                <ViewText value={form.title} />
              )}
            </FieldRow>

            <FieldRow label="작업유형">
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

            {/* === 작업일시 === */}
            <FieldRow label="작업일시">
                {isEditMode ? (
                    <div style={{ flex: 1, minWidth: 0 }}>
                    {/* 시작 */}
                    <div className={styles.itemDateBox}>
                        <div className={styles.itemDateLabel}>시작</div>

                        <div ref={startDateWrapperRef} className={styles.itemDate}>
                            {startDateText}
                            <img
                              src="/icon/search_calendar.png"
                              alt=""
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsStartDateOpen((v) => !v);
                              }}
                            />
                            {isStartDateOpen && (
                              <div className={styles.calendarPopover} onClick={(e) => e.stopPropagation()}>
                                <MiniCalendar
                                  value={parseDateText(startDateText)}
                                  showTodayButton
                                  size="modal"
                                  onPickDate={(date) => {
                                    const next = formatDate(date);
                                    setStartDateText(next);
                                    setForm((p) => ({ ...p, dateText: next }));
                                    // 종료일이 시작일보다 이전이면 동기화
                                    if (endDateText < next) setEndDateText(next);
                                    setIsStartDateOpen(false);
                                  }}
                                />
                              </div>
                            )}
                        </div>
                        <SharedCustomSelect
                          options={AMPM_OPTIONS}
                          value={AMPM_OPTIONS.find(o => o.label === form.startAmpm) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, startAmpm: opt.label as FormState["startAmpm"] }))}
                          placeholder="오전"
                          compact
                        />
                        <SharedCustomSelect
                          options={HOUR_OPTIONS}
                          value={HOUR_OPTIONS.find(o => o.label === String(form.startHour).padStart(2, "0")) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, startHour: Number(opt.label) }))}
                          placeholder="01"
                          compact
                        />
                        <SharedCustomSelect
                          options={MINUTE_OPTIONS}
                          value={MINUTE_OPTIONS.find(o => o.label === String(form.startMin).padStart(2, "0")) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, startMin: Number(opt.label) }))}
                          placeholder="00"
                          compact
                        />
                    </div>

                    {/* 종료 */}
                    <div style={{ marginTop: 8 }} />
                    <div className={styles.itemDateBox}>
                        <div className={styles.itemDateLabel}>종료</div>

                        <div ref={endDateWrapperRef} className={styles.itemDate}>
                        {endDateText}
                        <img
                          src="/icon/search_calendar.png"
                          alt=""
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsEndDateOpen((v) => !v);
                          }}
                        />
                        {isEndDateOpen && (
                          <div className={styles.calendarPopover} onClick={(e) => e.stopPropagation()}>
                            <MiniCalendar
                              value={parseDateText(endDateText)}
                              showTodayButton
                              size="modal"
                              onPickDate={(date) => {
                                const next = formatDate(date);
                                setEndDateText(next);
                                setIsEndDateOpen(false);
                              }}
                            />
                          </div>
                        )}
                        </div>
                        <SharedCustomSelect
                          options={AMPM_OPTIONS}
                          value={AMPM_OPTIONS.find(o => o.label === form.endAmpm) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, endAmpm: opt.label as FormState["endAmpm"] }))}
                          placeholder="오전"
                          compact
                        />
                        <SharedCustomSelect
                          options={HOUR_OPTIONS}
                          value={HOUR_OPTIONS.find(o => o.label === String(form.endHour).padStart(2, "0")) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, endHour: Number(opt.label) }))}
                          placeholder="01"
                          compact
                        />
                        <SharedCustomSelect
                          options={MINUTE_OPTIONS}
                          value={MINUTE_OPTIONS.find(o => o.label === String(form.endMin).padStart(2, "0")) ?? null}
                          onChange={(opt) => setForm((p) => ({ ...p, endMin: Number(opt.label) }))}
                          placeholder="00"
                          compact
                        />
                    </div>
                    </div>
                ) : (
                    <ViewText value={`${startDateText} ${form.startAmpm} ${pad2(form.startHour)}:${pad2(form.startMin)} ~ ${endDateText} ${form.endAmpm} ${pad2(form.endHour)}:${pad2(form.endMin)}`} />
                )}
                </FieldRow>
                {isEditMode && fieldErrors.dateTime && (
                  <div style={{ marginBottom: 8 }}>
                    <span className={styles.fieldError}>{fieldErrors.dateTime}</span>
                  </div>
                )}

              {!isEditMode && (
                <FieldRow label="작업요일">
                    <ViewText value={viewDowText || "-"} />
                </FieldRow>
              )}

            <FieldRow label="작업상태">
            {isEditMode ? (
                <SharedCustomSelect
                  placeholder="작업상태를 선택하세요"
                  value={WORK_STATUS.find(s => s.label === form.workStatus) ?? null}
                  options={WORK_STATUS}
                  onChange={(opt) => setForm((p) => ({ ...p, workStatus: opt.label }))}
                  error={!!fieldErrors.workStatus}
                />
            ) : (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span className={`${styles.statusDot} ${
                    form.workStatus === '대기' ? styles.statusDotWaiting
                    : form.workStatus === '진행중' || form.workStatus === '진행' ? styles.statusDotWorking
                    : form.workStatus === '완료' ? styles.statusDotCompleted
                    : form.workStatus === '오류' ? styles.statusDotError
                    : form.workStatus === '취소' ? styles.statusDotCancelled
                    : ''
                  }`} />
                  <ViewText value={form.workStatus} />
                </div>
            )}
            </FieldRow>
            {isEditMode && fieldErrors.workStatus && (
              <span className={styles.fieldError}>{fieldErrors.workStatus}</span>
            )}

            {isEditMode && (
                <>
                    {/* 반복설정 */}
                    <div className={styles.itemRadioBox}>
                    <div className={styles.itemtitle}>반복설정</div>

                    <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`}>
                        {/* 반복 */}
                        <div
                        className={styles.radioBtnBox}
                        role="button"
                        tabIndex={0}
                        onClick={() => setRepeatEnabled(true)}
                        >
                        <img
                            src={form.repeatEnabled ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                            alt=""
                        />
                        <span>반복</span>
                        </div>

                        {/* 반복 안함 */}
                        <div
                        className={styles.radioBtnBox}
                        role="button"
                        tabIndex={0}
                        onClick={() => setRepeatEnabled(false)}
                        >
                        <img
                            src={!form.repeatEnabled ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                            alt=""
                        />
                        <span>반복 안함</span>
                        </div>
                    </div>
                    </div>

                    {/* ✅ 조건: 반복 선택된 경우에만 표시 */}
                    {form.repeatEnabled && (
                    <>
                        <div className={styles.itemRadioBox}>
                            <div className={styles.itemtitle}>반복요일</div>

                            <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`} style={{ gap: 10 }}>
                                {DOWS.map((d) => {
                                const active = form.repeatDays.includes(d);
                                return (
                                    <button
                                    key={d}
                                    type="button"
                                    onClick={() => toggleRepeatDay(d)}
                                    className={`${styles.repeatDayBtn} ${active ? styles.repeatDayBtnActive : ""}`}
                                    >
                                    {d}
                                    </button>
                                );
                                })}

                                <label className={styles.everydayBox}>
                                <input
                                    type="checkbox"
                                    checked={form.repeatEveryday}
                                    onChange={(e) => toggleEveryday(e.target.checked)}
                                />
                                <span>매일</span>
                                </label>
                            </div>
                        </div>
                        {fieldErrors.repeatDays && (
                          <span className={styles.fieldError}>{fieldErrors.repeatDays}</span>
                        )}

                        <div className={styles.itemRadioBox}>
                        <div className={styles.itemtitle}>반복종료</div>

                        <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`}>
                            <div
                            className={styles.radioBtnBox}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setForm((p) => ({ ...p, repeatEndType: "none" }));
                              setIsRepeatEndDateOpen(false);
                            }}
                            >
                            <img
                                src={form.repeatEndType === "none" ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                alt=""
                            />
                            <span>없음</span>
                            </div>

                            <div
                            className={styles.radioBtnBox}
                            role="button"
                            tabIndex={0}
                            onClick={() => setForm((p) => ({
                              ...p,
                              repeatEndType: "date",
                              repeatEndDate: p.repeatEndDate || formatDate(new Date()),
                            }))}
                            >
                            <img
                                src={form.repeatEndType === "date" ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                alt=""
                            />
                            <span>종료 날짜</span>
                            </div>

                            {form.repeatEndType === "date" && (
                            <div
                                ref={repeatEndDateWrapperRef}
                                className={styles.repeatEndDateBox}
                            >
                                <span className={styles.repeatEndDateText}>
                                  {form.repeatEndDate || formatDate(new Date())}
                                </span>
                                <img
                                    src="/icon/search_calendar.png"
                                    alt=""
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setIsRepeatEndDateOpen((v) => !v);
                                    }}
                                />
                                {isRepeatEndDateOpen && (
                                    <div
                                        className={styles.calendarPopover}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <MiniCalendar
                                            value={parseDateText(form.repeatEndDate || formatDate(new Date()))}
                                            showTodayButton
                                            size="modal"
                                            onPickDate={(date) => {
                                                setForm((p) => ({ ...p, repeatEndDate: formatDate(date) }));
                                                setIsRepeatEndDateOpen(false);
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                        </div>
                    </>
                    )}
                </>
                )}

                {/* === 작업경로 === */}
                <FieldRow label="작업경로">
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
                    />
                ) : (
                    <ViewText value={form.pathName} />
                )}
                </FieldRow>
                {isEditMode && fieldErrors.pathName && (
                  <span className={styles.fieldError}>{fieldErrors.pathName}</span>
                )}

            <div className={styles.itemPathBox}>
              <div className={styles.itemtitle}>경로순서</div>
              <div className={styles.itemPath}>
                <div className={styles.itemScroll}>{form.pathOrder || "-"}</div>
              </div>
            </div>
            {isEditMode && (
              <div className={styles.pathBoxFlex}>
                <div></div>
                <button
                  type="button"
                  className={styles.itemBoxBtn}
                  onClick={() => router.push('/robots?tab=path')}
                >
                  경로 관리 →
                </button>
              </div>
            )}

            {!isEditMode && modifiedAtText && (
              <FieldRow label="수정 일시">
                <ViewText value={modifiedAtText} />
              </FieldRow>
            )}
          </div>}

          {/* 에러 배너 */}
          {apiError && (
            <div className={styles.errorMessage} style={{ marginTop: 12 }}>
              {apiError}
              <button className={styles.retryBtn} onClick={handleEditSave} style={{ marginLeft: 8 }}>
                다시 시도
              </button>
            </div>
          )}

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
    </>
  );
}
