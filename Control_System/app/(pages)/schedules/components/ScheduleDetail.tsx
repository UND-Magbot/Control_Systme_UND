'use client';

import styles from './ScheduleCrud.module.css';
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import DeleteConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import RepeatConfirmModal, { type RepeatConfirmMode, type RepeatConfirmScope } from '@/app/(pages)/schedules/components/RepeatConfirmModals';
import MiniCalendar from './MiniCalendar';
import { API_BASE } from "@/app/config";


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


// ✅ 목업 데이터(페이지 안에서 바로 사용)
const mockPathRows: PathRow[] = [
  {
    id: 1,
    pathName: "병동 → 검사실 이동",
    details: [
      { order: 1, label: "1F 병동 A" },
      { order: 2, label: "엘리베이터 탑승" },
      { order: 3, label: "2F 검사실" },
    ],
  },
  {
    id: 2,
    pathName: "3층 병실 순회",
    details: [
      { order: 1, label: "3F 간호스테이션" },
      { order: 2, label: "3F 병실 301" },
    ],
  },
  {
    id: 3,
    pathName: "외래 접수 동선",
    details: [
      { order: 1, label: "로비" },
      { order: 2, label: "접수처" },
      { order: 3, label: "약국" },
    ],
  },
];

// ✅ 셀렉트 옵션(경로명만 노출)
const PATH_OPTIONS: SelectOption[] = mockPathRows.map((p) => ({
  id: p.id,
  label: p.pathName,
}));

// 작업유형
type WorkType = { id: number; label: string };
const WORK_TYPES: WorkType[] = [
  { id: 1, label: '환자 모니터링' },
  { id: 2, label: '순찰 / 보안' },
  { id: 3, label: '물품 / 약품 운반' },
];

// 작업상태
type WorkStatus = { id: number; label: string };
const WORK_STATUS: WorkStatus[] = [
  { id: 1, label: '대기' },
  { id: 2, label: '진행중' },
  { id: 3, label: '완료' },
  { id: 4, label: '취소' },
];

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
    workStatus: '대기',

    dateText: '2025.12.12',
    dowText: '월, 화, 수',

    startAmpm: startA.ampm as '오전' | '오후',
    startHour: startA.h12,
    startMin: start.m,

    endAmpm: endA.ampm as '오전' | '오후',
    endHour: endA.h12,
    endMin: end.m,

    pathId: 1,
    pathName: mockPathRows[0]?.pathName ?? "경로명",
    pathDetails: mockPathRows[0]?.details ?? [],
    pathOrder: (mockPathRows[0]?.details ?? []).map((d) => d.label).join(" - "),

    repeatEnabled: true,                   // 초기: 반복으로 (원하면 false로)
    repeatDays: ['화', '목', '토'],         // 예시(이미지처럼)
    repeatEveryday: false,
    repeatEndType: 'none',
    repeatEndDate: '2025-12-13',
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
}: ScheduleDetailProps) {
  const router = useRouter();
    const [mode, setMode] = useState<Mode>('view');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // (예시) “수정 일시” 목업
    const modifiedAtText = '2025.12.11 오전 08:35:40';

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

    // ESC 키로 모달 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
        };

        if (isOpen) {
        document.addEventListener('keydown', handleEscape);
        document.body.style.overflow = 'hidden';
        }

        return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

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

    const [repeatConfirmOpen, setRepeatConfirmOpen] = useState(false);
    const [repeatConfirmMode, setRepeatConfirmMode] = useState<RepeatConfirmMode>("delete");
    const [repeatScope, setRepeatScope] = useState<RepeatConfirmScope>("this");

    // ===== actions =====
    const openRepeatConfirm = (mode: RepeatConfirmMode) => {
      setRepeatConfirmMode(mode);

      // 이미지 기본 선택값: 삭제=첫번째, 수정=두번째
      const def: RepeatConfirmScope = mode === "edit" ? "thisAndFuture" : "this";
      setRepeatScope(def);

      setRepeatConfirmOpen(true);
    };

    const handleEditStart = () => {
      // ✅ 반복 작업이면: 범위 선택 모달 먼저
      if (form.repeatEnabled) {
        openRepeatConfirm("edit");
        return;
      }
      setMode('edit');
    };

    const handleEditCancel = () => {
        setForm(initialForm);
        setMode('view');
    };

    const handleEditSave = () => {
        const startH24 = fromAmpmHour(form.startAmpm, form.startHour);
        const endH24 = fromAmpmHour(form.endAmpm, form.endHour);

        const nextStartMin = hmToMin(startH24, form.startMin);
        const nextEndMin = hmToMin(endH24, form.endMin);

        const payload = {
        id: event.id,
        robotNo: form.robotNo,
        title: form.title,
        robotType: form.workType,
        workStatus: form.workStatus,
        startMin: nextStartMin,
        endMin: nextEndMin,
        pathName: form.pathName,
        pathOrder: form.pathOrder,
        };

        // TODO: API 연결 시 여기에서 mutation
        console.log('저장 payload 예시:', payload);
        onUpdate?.(payload);

        setMode('view');
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

      fetch(`${API_BASE}/robots`)
        .then((res) => res.json())
        .then((data) =>
          setRobots(data.map((r: any, i: number) => ({
            id: i,
            label: r.no,
          })))
        );
    }, [isOpen]);

    const [pathOptions, setPathOptions] = useState<SelectOption[]>([]);

   useEffect(() => {
    if (!isOpen) return;

    fetch(`${API_BASE}/DB/getpath`)
      .then((res) => res.json())
      .then((data) =>
        setPathOptions(
          data.map((p: any) => ({
            id: p.id,
            label: p.WayName,
            order: p.WayPoints ?? "",   // ⭐ 핵심
          }))
        )
      );
  }, [isOpen]);

    const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);

    fetch(`${API_BASE}/DB/schedule/${event.id}`)
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
      })
      .finally(() => setLoading(false));
  }, [isOpen, event.id, pathOptions]);

    const handleDeleteCancel = () => setShowDeleteConfirm(false);

    const handleDeleteConfirm = () => {
        onDelete?.(event.id);
        setShowDeleteConfirm(false);
        onClose();
    };

    const handleRepeatConfirmCancel = () => {
      setRepeatConfirmOpen(false);
    };

    const handleRepeatConfirmOk = (scope: RepeatConfirmScope) => {
      setRepeatConfirmOpen(false);

      // 선택 범위 저장(추후 API payload로 사용)
      setRepeatScope(scope);

      if (repeatConfirmMode === "edit") {
        console.log("[repeat edit scope]", scope);
        setMode("edit");
        return;
      }

      // delete
      console.log("[repeat delete scope]", scope);
      onDelete?.(event.id);
      onClose();
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

    // 작업유형
    const [isWorkTypeOpen, setIsWorkTypeOpen] = useState(false);
    const workTypeWrapperRef = useRef<HTMLDivElement>(null);
    const workTypeScrollRef = useRef<HTMLDivElement>(null);
    const workTypeTrackRef = useRef<HTMLDivElement>(null);
    const workTypeThumbRef = useRef<HTMLDivElement>(null);

    // 작업상태
    const [isWorkStatusOpen, setIsWorkStatusOpen] = useState(false);
    const workStatusWrapperRef = useRef<HTMLDivElement>(null);
    const workStatusScrollRef = useRef<HTMLDivElement>(null);
    const workStatusTrackRef = useRef<HTMLDivElement>(null);
    const workStatusThumbRef = useRef<HTMLDivElement>(null);

    // ===== 시작시간 =====
    const [isStartAmpmOpen, setIsStartAmpmOpen] = useState(false);
    const [isStartHourOpen, setIsStartHourOpen] = useState(false);
    const [isStartMinOpen, setIsStartMinOpen] = useState(false);

    const startAmpmWrapperRef = useRef<HTMLDivElement>(null);
    const startHourWrapperRef = useRef<HTMLDivElement>(null);
    const startMinWrapperRef = useRef<HTMLDivElement>(null);

    const startAmpmScrollRef = useRef<HTMLDivElement>(null);
    const startHourScrollRef = useRef<HTMLDivElement>(null);
    const startMinScrollRef = useRef<HTMLDivElement>(null);

    const startAmpmTrackRef = useRef<HTMLDivElement>(null);
    const startHourTrackRef = useRef<HTMLDivElement>(null);
    const startMinTrackRef = useRef<HTMLDivElement>(null);

    const startAmpmThumbRef = useRef<HTMLDivElement>(null);
    const startHourThumbRef = useRef<HTMLDivElement>(null);
    const startMinThumbRef = useRef<HTMLDivElement>(null);

    // ===== 종료시간 =====
    const [isEndAmpmOpen, setIsEndAmpmOpen] = useState(false);
    const [isEndHourOpen, setIsEndHourOpen] = useState(false);
    const [isEndMinOpen, setIsEndMinOpen] = useState(false);
    const [isStartDateOpen, setIsStartDateOpen] = useState(false);
    const [isEndDateOpen, setIsEndDateOpen] = useState(false);
    const [isRepeatEndDateOpen, setIsRepeatEndDateOpen] = useState(false);

    const endAmpmWrapperRef = useRef<HTMLDivElement>(null);
    const endHourWrapperRef = useRef<HTMLDivElement>(null);
    const endMinWrapperRef = useRef<HTMLDivElement>(null);
    const startDateWrapperRef = useRef<HTMLDivElement>(null);
    const endDateWrapperRef = useRef<HTMLDivElement>(null);
    const repeatEndDateWrapperRef = useRef<HTMLDivElement>(null);

    const endAmpmScrollRef = useRef<HTMLDivElement>(null);
    const endHourScrollRef = useRef<HTMLDivElement>(null);
    const endMinScrollRef = useRef<HTMLDivElement>(null);

    const endAmpmTrackRef = useRef<HTMLDivElement>(null);
    const endHourTrackRef = useRef<HTMLDivElement>(null);
    const endMinTrackRef = useRef<HTMLDivElement>(null);

    const endAmpmThumbRef = useRef<HTMLDivElement>(null);
    const endHourThumbRef = useRef<HTMLDivElement>(null);
    const endMinThumbRef = useRef<HTMLDivElement>(null);

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

            if (workTypeWrapperRef.current && !workTypeWrapperRef.current.contains(t)) setIsWorkTypeOpen(false);
            if (workStatusWrapperRef.current && !workStatusWrapperRef.current.contains(t)) setIsWorkStatusOpen(false);

            if (startAmpmWrapperRef.current && !startAmpmWrapperRef.current.contains(t)) setIsStartAmpmOpen(false);
            if (startHourWrapperRef.current && !startHourWrapperRef.current.contains(t)) setIsStartHourOpen(false);
            if (startMinWrapperRef.current && !startMinWrapperRef.current.contains(t)) setIsStartMinOpen(false);

            if (endAmpmWrapperRef.current && !endAmpmWrapperRef.current.contains(t)) setIsEndAmpmOpen(false);
            if (endHourWrapperRef.current && !endHourWrapperRef.current.contains(t)) setIsEndHourOpen(false);
            if (endMinWrapperRef.current && !endMinWrapperRef.current.contains(t)) setIsEndMinOpen(false);
            if (startDateWrapperRef.current && !startDateWrapperRef.current.contains(t)) setIsStartDateOpen(false);
            if (endDateWrapperRef.current && !endDateWrapperRef.current.contains(t)) setIsEndDateOpen(false);
            if (repeatEndDateWrapperRef.current && !repeatEndDateWrapperRef.current.contains(t)) setIsRepeatEndDateOpen(false);
        };

        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, []);

    const shouldShowStartAmpmScroll = AMPM_OPTIONS.length >= 5;
    const shouldShowStartHourScroll = HOUR_OPTIONS.length >= 5;
    const shouldShowStartMinScroll = MINUTE_OPTIONS.length >= 5;
    const shouldShowEndAmpmScroll = AMPM_OPTIONS.length >= 5;
    const shouldShowEndHourScroll = HOUR_OPTIONS.length >= 5;
    const shouldShowEndMinScroll = MINUTE_OPTIONS.length >= 5;

    useCustomScrollbar({
    enabled: isWorkTypeOpen,
    scrollRef: workTypeScrollRef,
    trackRef: workTypeTrackRef,
    thumbRef: workTypeThumbRef,
    minThumbHeight: 50,
    deps: [WORK_TYPES.length],
    });

    useCustomScrollbar({
    enabled: isWorkStatusOpen,
    scrollRef: workStatusScrollRef,
    trackRef: workStatusTrackRef,
    thumbRef: workStatusThumbRef,
    minThumbHeight: 50,
    deps: [WORK_STATUS.length],
    });

    useCustomScrollbar({
    enabled: isStartAmpmOpen && shouldShowStartAmpmScroll,
    scrollRef: startAmpmScrollRef,
    trackRef: startAmpmTrackRef,
    thumbRef: startAmpmThumbRef,
    minThumbHeight: 30,
    deps: [AMPM_OPTIONS.length, isStartAmpmOpen],
    });

    useCustomScrollbar({
    enabled: isStartHourOpen && shouldShowStartHourScroll,
    scrollRef: startHourScrollRef,
    trackRef: startHourTrackRef,
    thumbRef: startHourThumbRef,
    minThumbHeight: 30,
    deps: [HOUR_OPTIONS.length, isStartHourOpen],
    });

    useCustomScrollbar({
    enabled: isStartMinOpen && shouldShowStartMinScroll,
    scrollRef: startMinScrollRef,
    trackRef: startMinTrackRef,
    thumbRef: startMinThumbRef,
    minThumbHeight: 30,
    deps: [MINUTE_OPTIONS.length, isStartMinOpen],
    });

    useCustomScrollbar({
    enabled: isEndAmpmOpen && shouldShowEndAmpmScroll,
    scrollRef: endAmpmScrollRef,
    trackRef: endAmpmTrackRef,
    thumbRef: endAmpmThumbRef,
    minThumbHeight: 30,
    deps: [AMPM_OPTIONS.length, isEndAmpmOpen],
    });

    useCustomScrollbar({
    enabled: isEndHourOpen && shouldShowEndHourScroll,
    scrollRef: endHourScrollRef,
    trackRef: endHourTrackRef,
    thumbRef: endHourThumbRef,
    minThumbHeight: 30,
    deps: [HOUR_OPTIONS.length, isEndHourOpen],
    });

    useCustomScrollbar({
    enabled: isEndMinOpen && shouldShowEndMinScroll,
    scrollRef: endMinScrollRef,
    trackRef: endMinTrackRef,
    thumbRef: endMinThumbRef,
    minThumbHeight: 30,
    deps: [MINUTE_OPTIONS.length, isEndMinOpen],
    });

    // 작업경로
    const [isPathOpen, setIsPathOpen] = useState(false);

    const pathWrapperRef = useRef<HTMLDivElement>(null);
    const pathScrollRef = useRef<HTMLDivElement>(null);
    const pathTrackRef = useRef<HTMLDivElement>(null);
    const pathThumbRef = useRef<HTMLDivElement>(null);


    // (선택) 바깥 클릭 닫기 로직에 추가
    useEffect(() => {
    const onDown = (e: MouseEvent) => {
        const t = e.target as Node;
        if (pathWrapperRef.current && !pathWrapperRef.current.contains(t)) {
        setIsPathOpen(false);
        }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    }, []);

    useCustomScrollbar({
      enabled: isPathOpen,
      scrollRef: pathScrollRef,
      trackRef: pathTrackRef,
      thumbRef: pathThumbRef,
      minThumbHeight: 50,
      deps: [pathOptions.length],
    });

  return (
    <>
      <div className={styles.scheduleModalOverlay} onClick={onClose}>
        <div className={styles.scheduleModalContainer} onClick={(e) => e.stopPropagation()}>
          <button className={styles.CloseBtn} onClick={onClose}>
            ✕
          </button>

          {/* 타이틀 */}
          <div className={styles.Title}>
            <div className={styles.TitleCircle}></div>
            <h2>{isEditMode ? '작업일정 수정' : workTypeTitle}</h2>
          </div>

          {/* 본문 */}
          <div className={styles.itemContainer}>
            <FieldRow label="로봇명">
              <ViewText value={form.robotNo}/>
            </FieldRow>

            <FieldRow label="작업명">
              {isEditMode ? (
                <input
                className={styles.editInput}
                  value={form.title}
                  onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="25자(50byte) 이내로 작성하세요"
                />
              ) : (
                <ViewText value={form.title} />
              )}
            </FieldRow>

            {/* 보기 모드에서는 '작업유형' 상세항목을 숨김 */}
            {isEditMode && (
            <FieldRow label="작업유형">
                <CustomSelect
                placeholder="작업유형 선택"
                value={form.workType || null}
                options={robots}
                isOpen={isWorkTypeOpen}
                setIsOpen={setIsWorkTypeOpen}
                onSelect={(opt) => setForm((p) => ({ ...p, workType: opt.label}))}
                wrapperRef={workTypeWrapperRef}
                scrollRef={workTypeScrollRef}
                trackRef={workTypeTrackRef}
                thumbRef={workTypeThumbRef}
                />
            </FieldRow>
            )}
            {isEditMode ? (
            <br />
            ) : null}
            <FieldRow label={isEditMode ? "작업일시" : "작업기간"}>
                {isEditMode ? (
                    <div style={{ width: 373, height: 70  }}>
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
                                    setIsStartDateOpen(false);
                                  }}
                                />
                              </div>
                            )}
                        </div>
                        <div ref={startAmpmWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                          <div
                            className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`}
                            onClick={() => setIsStartAmpmOpen((v) => !v)}
                          >
                            <span>{form.startAmpm}</span>
                            <img src={isStartAmpmOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                          </div>
                          {isStartAmpmOpen && (
                            <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                              <div ref={startAmpmScrollRef} className={styles.selecteInner} role="listbox">
                                {AMPM_OPTIONS.map((opt) => (
                                  <div
                                    key={opt.id}
                                    className={`${styles.selecteOption} ${form.startAmpm === opt.label ? styles.selecteOptionActive : ""}`.trim()}
                                    onClick={() => {
                                      setForm((p) => ({ ...p, startAmpm: opt.label as FormState["startAmpm"] }));
                                      setIsStartAmpmOpen(false);
                                    }}
                                  >
                                    {opt.label}
                                  </div>
                                ))}
                              </div>
                              {shouldShowStartAmpmScroll && (
                              <div ref={startAmpmTrackRef} className={styles.selecteScrollTrack}>
                                <div ref={startAmpmThumbRef} className={styles.selecteScrollThumb} />
                              </div>
                            )}
                            </div>
                          )}
                        </div>

                        <div ref={startHourWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                          <div
                            className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`}
                            onClick={() => setIsStartHourOpen((v) => !v)}
                          >
                            <span>{String(form.startHour).padStart(2, "0")}</span>
                            <img src={isStartHourOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                          </div>
                          {isStartHourOpen && (
                            <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                              <div ref={startHourScrollRef} className={styles.selecteInner} role="listbox">
                                {HOUR_OPTIONS.map((opt) => (
                                  <div
                                    key={opt.id}
                                    className={`${styles.selecteOption} ${String(form.startHour).padStart(2, "0") === opt.label ? styles.selecteOptionActive : ""}`.trim()}
                                    onClick={() => {
                                      setForm((p) => ({ ...p, startHour: Number(opt.label) }));
                                      setIsStartHourOpen(false);
                                    }}
                                  >
                                    {opt.label}
                                  </div>
                                ))}
                              </div>
                              {shouldShowStartHourScroll && (
                              <div ref={startHourTrackRef} className={styles.selecteScrollTrack}>
                                <div ref={startHourThumbRef} className={styles.selecteScrollThumb} />
                              </div>
                            )}
                            </div>
                          )}
                        </div>

                        <div ref={startMinWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                          <div
                            className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`}
                            onClick={() => setIsStartMinOpen((v) => !v)}
                          >
                            <span>{String(form.startMin).padStart(2, "0")}</span>
                            <img src={isStartMinOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                          </div>
                          {isStartMinOpen && (
                            <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                              <div ref={startMinScrollRef} className={styles.selecteInner} role="listbox">
                                {MINUTE_OPTIONS.map((opt) => (
                                  <div
                                    key={opt.id}
                                    className={`${styles.selecteOption} ${String(form.startMin).padStart(2, "0") === opt.label ? styles.selecteOptionActive : ""}`.trim()}
                                    onClick={() => {
                                      setForm((p) => ({ ...p, startMin: Number(opt.label) }));
                                      setIsStartMinOpen(false);
                                    }}
                                  >
                                    {opt.label}
                                  </div>
                                ))}
                              </div>
                              {shouldShowStartMinScroll && (
                              <div ref={startMinTrackRef} className={styles.selecteScrollTrack}>
                                <div ref={startMinThumbRef} className={styles.selecteScrollThumb} />
                              </div>
                            )}
                            </div>
                          )}
                        </div>
                    </div>

                    {/* 종료 */}
                    <br />
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
                        <div ref={endAmpmWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                          <div
                            className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`}
                            onClick={() => setIsEndAmpmOpen((v) => !v)}
                          >
                            <span>{form.endAmpm}</span>
                            <img src={isEndAmpmOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                          </div>
                          {isEndAmpmOpen && (
                            <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                              <div ref={endAmpmScrollRef} className={styles.selecteInner} role="listbox">
                                {AMPM_OPTIONS.map((opt) => (
                                  <div
                                    key={opt.id}
                                    className={`${styles.selecteOption} ${form.endAmpm === opt.label ? styles.selecteOptionActive : ""}`.trim()}
                                    onClick={() => {
                                      setForm((p) => ({ ...p, endAmpm: opt.label as FormState["endAmpm"] }));
                                      setIsEndAmpmOpen(false);
                                    }}
                                  >
                                    {opt.label}
                                  </div>
                                ))}
                              </div>
                              {shouldShowEndAmpmScroll && (
                              <div ref={endAmpmTrackRef} className={styles.selecteScrollTrack}>
                                <div ref={endAmpmThumbRef} className={styles.selecteScrollThumb} />
                              </div>
                            )}
                            </div>
                          )}
                        </div>

                        <div ref={endHourWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                          <div
                            className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`}
                            onClick={() => setIsEndHourOpen((v) => !v)}
                          >
                            <span>{String(form.endHour).padStart(2, "0")}</span>
                            <img src={isEndHourOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                          </div>
                          {isEndHourOpen && (
                            <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                              <div ref={endHourScrollRef} className={styles.selecteInner} role="listbox">
                                {HOUR_OPTIONS.map((opt) => (
                                  <div
                                    key={opt.id}
                                    className={`${styles.selecteOption} ${String(form.endHour).padStart(2, "0") === opt.label ? styles.selecteOptionActive : ""}`.trim()}
                                    onClick={() => {
                                      setForm((p) => ({ ...p, endHour: Number(opt.label) }));
                                      setIsEndHourOpen(false);
                                    }}
                                  >
                                    {opt.label}
                                  </div>
                                ))}
                              </div>
                              {shouldShowEndHourScroll && (
                              <div ref={endHourTrackRef} className={styles.selecteScrollTrack}>
                                <div ref={endHourThumbRef} className={styles.selecteScrollThumb} />
                              </div>
                            )}
                            </div>
                          )}
                        </div>

                        <div ref={endMinWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                          <div
                            className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`}
                            onClick={() => setIsEndMinOpen((v) => !v)}
                          >
                            <span>{String(form.endMin).padStart(2, "0")}</span>
                            <img src={isEndMinOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                          </div>
                          {isEndMinOpen && (
                            <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                              <div ref={endMinScrollRef} className={styles.selecteInner} role="listbox">
                                {MINUTE_OPTIONS.map((opt) => (
                                  <div
                                    key={opt.id}
                                    className={`${styles.selecteOption} ${String(form.endMin).padStart(2, "0") === opt.label ? styles.selecteOptionActive : ""}`.trim()}
                                    onClick={() => {
                                      setForm((p) => ({ ...p, endMin: Number(opt.label) }));
                                      setIsEndMinOpen(false);
                                    }}
                                  >
                                    {opt.label}
                                  </div>
                                ))}
                              </div>
                              {shouldShowEndMinScroll && (
                              <div ref={endMinTrackRef} className={styles.selecteScrollTrack}>
                                <div ref={endMinThumbRef} className={styles.selecteScrollThumb} />
                              </div>
                            )}
                            </div>
                          )}
                        </div>
                    </div>
                    </div>
                ) : (
                    <ViewText value={formatTimeRangeFromForm(form)} />
                )}
                </FieldRow>
                {isEditMode ? (
                    <br />
                ) : null}

              {!isEditMode  &&  (
                <>
                    <FieldRow label="작업요일">
                        <ViewText value={viewDowText} />
                    </FieldRow>
                </>
              )}

            

            <FieldRow label="작업상태">
            {isEditMode ? (
                <CustomSelect
                placeholder="작업상태를 선택하세요"
                value={form.workStatus || null}
                options={WORK_STATUS}
                isOpen={isWorkStatusOpen}
                setIsOpen={setIsWorkStatusOpen}
                onSelect={(opt) => setForm((p) => ({ ...p, workStatus: opt.label }))}
                wrapperRef={workStatusWrapperRef}
                scrollRef={workStatusScrollRef}
                trackRef={workStatusTrackRef}
                thumbRef={workStatusThumbRef}
                />
            ) : (
                <ViewText value={form.workStatus} />
            )}
            </FieldRow>

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
                            onClick={() => setForm((p) => ({ ...p, repeatEndType: "date" }))}
                            style={{ gap: 10 }}
                            >
                            <img
                                src={form.repeatEndType === "date" ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                alt=""
                            />
                            <span>종료 날짜</span>

                            <div
                                ref={repeatEndDateWrapperRef}
                                className={`${styles.repeatEndDateBox} ${
                                form.repeatEndType !== "date" ? styles.repeatEndDateBoxDisabled : ""
                                }`}
                            >
                                <span className={styles.repeatEndDateText}>{form.repeatEndDate}</span>
                                <img
                                    src="/icon/search_calendar.png"
                                    alt=""
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (form.repeatEndType === "date") {
                                            setIsRepeatEndDateOpen((v) => !v);
                                        }
                                    }}
                                />
                                {form.repeatEndType === "date" && isRepeatEndDateOpen && (
                                    <div
                                        className={styles.calendarPopover}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <MiniCalendar
                                            value={parseDateText(form.repeatEndDate)}
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
                            </div>
                        </div>
                        </div>
                    </>
                    )}
                </>
                )}

                <FieldRow label="작업경로">
                {isEditMode ? (
                    <CustomSelect
                    placeholder="작업경로 선택"
                    value={form.pathName || null}
                    options={pathOptions}
                    isOpen={isPathOpen}
                    setIsOpen={setIsPathOpen}
                    onSelect={(opt) => {
                      setForm((prev) => ({
                      ...prev,
                      pathId: opt.id,
                      pathName: opt.label,
                      pathOrder: opt.order ?? "",
                      }));
                    }}
                    wrapperRef={pathWrapperRef}
                    scrollRef={pathScrollRef}
                    trackRef={pathTrackRef}
                    thumbRef={pathThumbRef}
                    />
                ) : (
                    <ViewText value={form.pathName} />
                )}
                </FieldRow>

            <div className={`${styles.itemPathBox} ${isEditMode ? styles.itemPathBoxEdit : ""}`}>
              <div className={styles.itemtitle}>경로순서</div>
              <div className={styles.itemPath}>
                <div className={styles.itemScroll}>{form.pathOrder}</div>
              </div>
              {isEditMode && (
                <div className={styles.itemPathAction}>
                  <button
                    type="button"
                    className={styles.itemBoxBtn}
                    onClick={() => router.push('/robots?tab=path')}
                  >
                    작업경로 등록 화면 →
                  </button>
                </div>
              )}
            </div>


            {!isEditMode && (
              <FieldRow label="수정 일시">
                <ViewText value={modifiedAtText} />
              </FieldRow>
            )}
          </div>

          {/* 하단 버튼 */}
          <div className={styles.btnTotal}>
            <div className={styles.btnLeftBox}>
              {mode === 'view' ? (
                <>
                  <button
                    type="button"
                    className={`${styles.btnItemCommon} ${styles.btnBgGray} ${styles.mr10}`}
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
                    className={`${styles.btnItemCommon} ${styles.btnBgGray} ${styles.mr10}`}
                    onClick={handleEditCancel}
                  >
                    <img src="/icon/close_btn.png" alt="cancel" />
                    <span>취소</span>
                  </button>

                  <button
                    type="button"
                    className={`${styles.btnItemCommon} ${styles.btnBgGray}`}
                    onClick={handleEditSave}
                  >
                    <img src="/icon/check.png" alt="save" />
                    <span>저장</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 삭제 확인 (목업) */}
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
    </>
  );
}
