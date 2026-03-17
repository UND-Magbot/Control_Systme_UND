'use client';

import styles from './ScheduleCrud.module.css';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { RobotRowData } from '@/app/type';
import MiniCalendar from './MiniCalendar';
import { useCustomScrollbar } from '@/app/hooks/useCustomScrollbar';
import { API_BASE } from "@/app/config";

type InsertModalProps = {
    isOpen: boolean;
    onClose: () => void;
    robots: RobotRowData[];
}

// 작업유형
export type WorkType = {
  id: number;
  label: string;
};

const WORK_TYPES: WorkType[] = [
  { id: 1, label: "환자 모니터링" },
  { id: 2, label: "순찰 / 보안" },
  { id: 3, label: "물품 / 약품 운반" },
];

// 작업상태
export type WorkStatus = {
  id: number;
  label: string;
};

const WORK_STATUS: WorkStatus[] = [
  { id: 1, label: "대기" },
  { id: 2, label: "진행중" },
  { id: 3, label: "완료" },
  { id: 4, label: "취소" },
];

// 오전 / 오후
const AMPM = ["오전", "오후"];

// 시 / 분
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1~12
const MINUTES = ["00", "10", "20", "30", "40", "50"];

type WorkPathOption = {
  id: number;
  wayName: string;   // way_info.WayName
  robotName: string; // way_info.RobotName
};

export default function InsertModal({
    isOpen,
    onClose,
    robots
}:InsertModalProps ){
    
    const [showConfirm, setShowConfirm] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const router = useRouter();

    const hourOptions = useMemo(() => HOURS.map((hour) => String(hour).padStart(2, '0')), []);
    const [workPathOptions, setWorkPathOptions] = useState<WorkPathOption[]>([]);

    const today = useMemo(() => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        return date;
    }, []);

    const formatDate = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const DOWS = ["월", "화", "수", "목", "금", "토", "일"] as const;
    type Dow = (typeof DOWS)[number];

    // 로봇명 선택
    const [isRobotOpen, setIsRobotOpen] = useState(false);
    const robotWrapperRef = useRef<HTMLDivElement>(null);
    const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

    const robotScrollRef = useRef<HTMLDivElement>(null);
    const robotTrackRef = useRef<HTMLDivElement>(null);
    const robotThumbRef = useRef<HTMLDivElement>(null);
    
    const [taskName, setTaskName] = useState("");
    // 작업유형 선택
    const [isWorkTypeOpen, setIsWorkTypeOpen] = useState(false);
    const workTypeWrapperRef = useRef<HTMLDivElement>(null);
    const [selectedWorkType, setSelectedWorkType] = useState<WorkType | null>(null);

    const workTypeScrollRef = useRef<HTMLDivElement>(null);
    const workTypeTrackRef = useRef<HTMLDivElement>(null);
    const workTypeThumbRef = useRef<HTMLDivElement>(null);
    
    // 작업상태 선택
    const [isWorkStatusOpen, setIsWorkStatusOpen] = useState(false);
    const workStatusWrapperRef = useRef<HTMLDivElement>(null);
    const [selectedWorkStatus, setSelectedWorkStatus] = useState<WorkStatus | null>(null);

    const statusScrollRef = useRef<HTMLDivElement>(null);
    const statusTrackRef = useRef<HTMLDivElement>(null);
    const statusThumbRef = useRef<HTMLDivElement>(null);
    
    // 작업경로 선택
    const [isWorkPathOpen , setIsWorkPathOpen] = useState(false);
    const workPathWrapperRef = useRef<HTMLDivElement>(null);
    const [selectedWorkPath, setSelectedWorkPath] = useState<WorkPathOption | null>(null);

    const pathScrollRef = useRef<HTMLDivElement>(null);
    const pathTrackRef = useRef<HTMLDivElement>(null);
    const pathThumbRef = useRef<HTMLDivElement>(null);

    // 반복 설정
    const [repeatEnabled, setRepeatEnabled] = useState(false);
    const [repeatDays, setRepeatDays] = useState<Dow[]>([]);
    const [repeatEveryday, setRepeatEveryday] = useState(false);
    const [repeatEndType, setRepeatEndType] = useState<'none' | 'date'>('none');
    const [repeatEndDate, setRepeatEndDate] = useState(formatDate(today));
    const [isRepeatEndDateOpen, setIsRepeatEndDateOpen] = useState(false);
    const repeatEndDateWrapperRef = useRef<HTMLDivElement>(null);

    // 작업일시 날짜
    const [startDate, setStartDate] = useState<Date>(today);
    const [endDate, setEndDate] = useState<Date>(today);
    const [isStartDateOpen, setIsStartDateOpen] = useState(false);
    const [isEndDateOpen, setIsEndDateOpen] = useState(false);
    const startDateWrapperRef = useRef<HTMLDivElement>(null);
    const endDateWrapperRef = useRef<HTMLDivElement>(null);

    // 시작 오전/오후
    const [isStartAmpmOpen, setIsStartAmpmOpen] = useState(false);
    const [startAmpm, setStartAmpm] = useState<string | null>(null);
    const startAmpmWrapperRef = useRef<HTMLDivElement>(null);
    const startAmpmScrollRef = useRef<HTMLDivElement>(null);
    const startAmpmTrackRef = useRef<HTMLDivElement>(null);
    const startAmpmThumbRef = useRef<HTMLDivElement>(null);

    // 종료 오전/오후
    const [isEndAmpmOpen, setIsEndAmpmOpen] = useState(false);
    const [endAmpm, setEndAmpm] = useState<string | null>(null);
    const endAmpmWrapperRef = useRef<HTMLDivElement>(null);
    const endAmpmScrollRef = useRef<HTMLDivElement>(null);
    const endAmpmTrackRef = useRef<HTMLDivElement>(null);
    const endAmpmThumbRef = useRef<HTMLDivElement>(null);
    
    // 시작 시
    const [isStartHourOpen, setIsStartHourOpen] = useState(false);
    const startHourWrapperRef = useRef<HTMLDivElement>(null);
    const [startHour, setStartHour] = useState<string | null>(null);
    const startHourScrollRef = useRef<HTMLDivElement>(null);
    const startHourTrackRef = useRef<HTMLDivElement>(null);
    const startHourThumbRef = useRef<HTMLDivElement>(null);

    // 종료 시
    const [isEndHourOpen, setIsEndHourOpen] = useState(false);
    const endHourWrapperRef = useRef<HTMLDivElement>(null);
    const [endHour, setEndHour] = useState<string | null>(null);
    const endHourScrollRef = useRef<HTMLDivElement>(null);
    const endHourTrackRef = useRef<HTMLDivElement>(null);
    const endHourThumbRef = useRef<HTMLDivElement>(null);
    
    // 시작 분
    const [isStartMinOpen, setIsStartMinOpen] = useState(false);
    const startMinWrapperRef = useRef<HTMLDivElement>(null);
    const [startMin, setStartMin] = useState<string | null>(null);
    const startMinScrollRef = useRef<HTMLDivElement>(null);
    const startMinTrackRef = useRef<HTMLDivElement>(null);
    const startMinThumbRef = useRef<HTMLDivElement>(null);

    // 종료 분
    const [isEndMinOpen, setIsEndMinOpen] = useState(false);
    const endMinWrapperRef = useRef<HTMLDivElement>(null);
    const [endMin, setEndMin] = useState<string | null>(null);
    const endMinScrollRef = useRef<HTMLDivElement>(null);
    const endMinTrackRef = useRef<HTMLDivElement>(null);
    const endMinThumbRef = useRef<HTMLDivElement>(null);

    // ESC 키로 모달 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden'; // 스크롤 방지
        }
        
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);


    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
            if (
                robotWrapperRef.current &&
                !robotWrapperRef.current.contains(e.target as Node)
            ) {
                setIsRobotOpen(false);
            }

            if (
                workTypeWrapperRef.current &&
                !workTypeWrapperRef.current.contains(e.target as Node)
            ) {
                setIsWorkTypeOpen(false);
            }

            if (
                workStatusWrapperRef.current &&
                !workStatusWrapperRef.current.contains(e.target as Node)
            ) {
                setIsWorkStatusOpen(false);
            }

            if (
                workPathWrapperRef.current &&
                !workPathWrapperRef.current.contains(e.target as Node)
            ) {
                setIsWorkPathOpen(false);
            }

            if (
                startDateWrapperRef.current &&
                !startDateWrapperRef.current.contains(e.target as Node)
            ) {
                setIsStartDateOpen(false);
            }

            if (
                endDateWrapperRef.current &&
                !endDateWrapperRef.current.contains(e.target as Node)
            ) {
                setIsEndDateOpen(false);
            }

            if (
                startAmpmWrapperRef.current &&
                !startAmpmWrapperRef.current.contains(e.target as Node)
            ) {
                setIsStartAmpmOpen(false);
            }

            if (
                endAmpmWrapperRef.current &&
                !endAmpmWrapperRef.current.contains(e.target as Node)
            ) {
                setIsEndAmpmOpen(false);
            }

            if (
                startHourWrapperRef.current &&
                !startHourWrapperRef.current.contains(e.target as Node)
            ) {
                setIsStartHourOpen(false);
            }

            if (
                endHourWrapperRef.current &&
                !endHourWrapperRef.current.contains(e.target as Node)
            ) {
                setIsEndHourOpen(false);
            }

            if (
                startMinWrapperRef.current &&
                !startMinWrapperRef.current.contains(e.target as Node)
            ) {
                setIsStartMinOpen(false);
            }

            if (
                endMinWrapperRef.current &&
                !endMinWrapperRef.current.contains(e.target as Node)
            ) {
                setIsEndMinOpen(false);
            }

            if (
                repeatEndDateWrapperRef.current &&
                !repeatEndDateWrapperRef.current.contains(e.target as Node)
            ) {
                setIsRepeatEndDateOpen(false);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        fetch(`${API_BASE}/DB/way-names`) // 예시
            .then(res => res.json())
            .then((data) => {
            const paths = data.map((row: any) => ({
                id: row.id,
                wayName: row.WayName,
                robotName: row.RobotName,
            }));
            setWorkPathOptions(paths);
            });
    }, [isOpen]);

    const toggleRepeatDay = (d: Dow) => {
        setRepeatDays((prev) => {
            const exists = prev.includes(d);
            const nextDays = exists ? prev.filter((x) => x !== d) : [...prev, d];
            setRepeatEveryday(nextDays.length === 7);
            return nextDays;
        });
    };

    const toggleEveryday = (checked: boolean) => {
        setRepeatEveryday(checked);
        setRepeatDays(checked ? [...DOWS] : []);
    };

    const handleRepeatEnabled = (enabled: boolean) => {
        setRepeatEnabled(enabled);
        if (!enabled) {
            setRepeatDays([]);
            setRepeatEveryday(false);
            setRepeatEndType('none');
            setRepeatEndDate(formatDate(today));
            setIsRepeatEndDateOpen(false);
        }
    };

    const shouldShowRobotScroll = robots.length >= 5;
    const shouldShowWorkTypeScroll = WORK_TYPES.length >= 5;
    const shouldShowWorkStatusScroll = WORK_STATUS.length >= 5;
    const shouldShowWorkPathScroll = workPathOptions.length >= 5;
    const shouldShowStartAmpmScroll = AMPM.length >= 5;
    const shouldShowEndAmpmScroll = AMPM.length >= 5;
    const shouldShowStartHourScroll = hourOptions.length >= 5;
    const shouldShowEndHourScroll = hourOptions.length >= 5;
    const shouldShowStartMinScroll = MINUTES.length >= 5;
    const shouldShowEndMinScroll = MINUTES.length >= 5;
    
    useCustomScrollbar({
        enabled: isRobotOpen && shouldShowRobotScroll,
        scrollRef: robotScrollRef,
        trackRef: robotTrackRef,
        thumbRef: robotThumbRef,
        minThumbHeight: 30,
        deps: [robots.length, isRobotOpen],
    });

    useCustomScrollbar({
        enabled: isWorkTypeOpen && shouldShowWorkTypeScroll,
        scrollRef: workTypeScrollRef,
        trackRef: workTypeTrackRef,
        thumbRef: workTypeThumbRef,
        minThumbHeight: 30,
        deps: [WORK_TYPES.length, isWorkTypeOpen],
    });

    useCustomScrollbar({
        enabled: isWorkStatusOpen && shouldShowWorkStatusScroll,
        scrollRef: statusScrollRef,
        trackRef: statusTrackRef,
        thumbRef: statusThumbRef,
        minThumbHeight: 30,
        deps: [WORK_STATUS.length, isWorkStatusOpen],
    });

    useCustomScrollbar({
        enabled: isWorkPathOpen && shouldShowWorkPathScroll,
        scrollRef: pathScrollRef,
        trackRef: pathTrackRef,
        thumbRef: pathThumbRef,
        minThumbHeight: 30,
        deps: [workPathOptions.length, isWorkPathOpen],
    });

    useCustomScrollbar({
        enabled: isStartAmpmOpen && shouldShowStartAmpmScroll,
        scrollRef: startAmpmScrollRef,
        trackRef: startAmpmTrackRef,
        thumbRef: startAmpmThumbRef,
        minThumbHeight: 30,
        deps: [AMPM.length, isStartAmpmOpen],
    });

    useCustomScrollbar({
        enabled: isEndAmpmOpen && shouldShowEndAmpmScroll,
        scrollRef: endAmpmScrollRef,
        trackRef: endAmpmTrackRef,
        thumbRef: endAmpmThumbRef,
        minThumbHeight: 30,
        deps: [AMPM.length, isEndAmpmOpen],
    });

    useCustomScrollbar({
        enabled: isStartHourOpen && shouldShowStartHourScroll,
        scrollRef: startHourScrollRef,
        trackRef: startHourTrackRef,
        thumbRef: startHourThumbRef,
        minThumbHeight: 30,
        deps: [hourOptions.length, isStartHourOpen],
    });

    useCustomScrollbar({
        enabled: isEndHourOpen && shouldShowEndHourScroll,
        scrollRef: endHourScrollRef,
        trackRef: endHourTrackRef,
        thumbRef: endHourThumbRef,
        minThumbHeight: 30,
        deps: [hourOptions.length, isEndHourOpen],
    });

    useCustomScrollbar({
        enabled: isStartMinOpen && shouldShowStartMinScroll,
        scrollRef: startMinScrollRef,
        trackRef: startMinTrackRef,
        thumbRef: startMinThumbRef,
        minThumbHeight: 30,
        deps: [MINUTES.length, isStartMinOpen],
    });

    useCustomScrollbar({
        enabled: isEndMinOpen && shouldShowEndMinScroll,
        scrollRef: endMinScrollRef,
        trackRef: endMinTrackRef,
        thumbRef: endMinThumbRef,
        minThumbHeight: 30,
        deps: [MINUTES.length, isEndMinOpen],
    });
        
    if (!isOpen) return null;

    // 삭제 버튼 클릭 핸들러
    const handleDelete = () => {
      setShowConfirm(true);   // 커스텀 confirm 열기
    };
  
    // 삭제 재 확인 창 - confirm 창에서 확인 눌렀을 때
    const handleConfirmOk = () => {
      setShowConfirm(false);
      onClose();
    };
  
     // 삭제 재 확인 창 - confirm 창만 닫기
    const handleConfirmCancel = () => {
      setShowConfirm(false);
    };
 
    const handleUdate = () => {
        setIsEditMode(true);
        console.log("수정되었습니다.");
    };

    
    const handleCancel = () => {
        onClose();
    };
      
    const makeDateTime = (
        date: Date,
        ampm: string,
        hour: string,
        minute: string
        ) => {
        let h = Number(hour);
        if (ampm === "오후" && h !== 12) h += 12;
        if (ampm === "오전" && h === 12) h = 0;

        const d = new Date(date);
        d.setHours(h, Number(minute), 0, 0);

        // ✅ 로컬 기준 문자열로 변환
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        const HH = String(d.getHours()).padStart(2, "0");
        const MM = String(d.getMinutes()).padStart(2, "0");

        return `${yyyy}-${mm}-${dd} ${HH}:${MM}:00`;
    };
    
    const handleSave = async () => {
        if (!selectedRobot || !selectedWorkType || !selectedWorkPath) {
            alert("필수 항목을 선택하세요");
            return;
        }

        const payload = {
            RobotName: selectedRobot.no,
            TaskName: taskName, // ← input 연결해주면 됨
            TaskType: selectedWorkType.label,
            WayName: selectedWorkPath.wayName,
            WorkStatus: selectedWorkStatus?.label ?? "대기",

            StartTime: makeDateTime(
            startDate,
            startAmpm ?? "오전",
            startHour ?? "01",
            startMin ?? "00"
            ),
            EndTime: makeDateTime(
            endDate,
            endAmpm ?? "오전",
            endHour ?? "01",
            endMin ?? "00"
            ),

            Repeat: repeatEnabled,
            RepeatDays: repeatDays.length ? repeatDays.join(",") : null,
            RepeatEndDate:
            repeatEndType === "date" ? repeatEndDate : null,
        };

        const res = await fetch(`${API_BASE}/DB/schedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            alert("스케줄 저장 실패");
            return;
        }

        onClose();
    };

    const handleGoToPathManage = () => {
        router.push("/robots?tab=path");
    };

    return (
        <>
            <div className={styles.scheduleModalOverlay} onClick={onClose}>
                <div className={styles.scheduleModalContainer} onClick={(e) => e.stopPropagation()}>
                    <button className={styles.CloseBtn} onClick={onClose}>✕</button>
                    <div className={styles.Title}>
                        <img src="/icon/robot_schedule_w.png" alt="Robot Registeration" />
                        <h2>작업일정 등록</h2>
                    </div>
                    <div className={styles.itemContainer}>
                        <div className={styles.itemBox}>
                            <div>로봇명</div>
                            <div ref={robotWrapperRef} className={styles.selecteWrapper}>
                                <div className={styles.selecte} onClick={() => setIsRobotOpen((v) => !v)}>
                                    <span>{selectedRobot?.no ?? "로봇명 선택"}</span>
                                    <img src={isRobotOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="arrow" />
                                </div> 
                                {isRobotOpen && (
                                    <div className={styles.selectebox}>
                                        <div ref={robotScrollRef} className={styles.selecteInner} role="listbox">
                                        {robots.map((robot) => (
                                            <div
                                                key={robot.id}
                                                className={`${styles.selecteOption} ${selectedRobot?.id === robot.id ? styles.selecteOptionActive : ""}`.trim()}
                                                onClick={() => {
                                                    setSelectedRobot(robot);
                                                    setIsRobotOpen(false);
                                                }}
                                            >
                                                {robot.no}
                                            </div>
                                        ))}
                                        </div>

                                        {shouldShowRobotScroll && (
                                            <div ref={robotTrackRef} className={styles.selecteScrollTrack}>
                                                <div ref={robotThumbRef} className={styles.selecteScrollThumb} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={styles.itemBox}>
                            <div>작업명</div>
                            <input
                                type="text"
                                placeholder="25자(50byte) 이내로 작성하세요"
                                value={taskName}
                                onChange={(e) => setTaskName(e.target.value)}
                                maxLength={25}
                            />
                        </div>
                        
                        <div className={styles.itemBox}>
                            <div>작업유형</div>

                            <div ref={workTypeWrapperRef} className={styles.selecteWrapper}>
                                <div
                                className={styles.selecte}
                                onClick={() => setIsWorkTypeOpen((v) => !v)}
                                >
                                    <span>{selectedWorkType?.label ?? "작업유형 선택"}</span>
                                    <img
                                        src={isWorkTypeOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
                                        alt=""
                                    />
                                </div>

                                {isWorkTypeOpen && (
                                <div className={styles.selectebox}>
                                    <div ref={workTypeScrollRef} className={styles.selecteInner} role="listbox">
                                    {WORK_TYPES.map((type) => (
                                        <div
                                        key={type.id}
                                        className={`${styles.selecteOption} ${selectedWorkType?.id === type.id ? styles.selecteOptionActive : ""}`.trim()}
                                        onClick={() => {
                                            setSelectedWorkType(type);
                                            setIsWorkTypeOpen(false);
                                        }}
                                        >
                                        {type.label}
                                        </div>
                                    ))}
                                    </div>

                                    {shouldShowWorkTypeScroll && (
                                        <div ref={workTypeTrackRef} className={styles.selecteScrollTrack}>
                                            <div ref={workTypeThumbRef} className={styles.selecteScrollThumb} />
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                        </div>

                        <div className={styles.itemBox}>
                            <div>작업일시</div>
                            <div className={styles.itemDateBox}>
                                <div>시작</div>
                                <div ref={startDateWrapperRef} className={styles.itemDate}>
                                    {formatDate(startDate)}
                                    <img
                                        src="/icon/search_calendar.png"
                                        alt=""
                                        onClick={() => setIsStartDateOpen((v) => !v)}
                                    />
                                    {isStartDateOpen && (
                                        <div className={styles.calendarPopover}>
                                            <MiniCalendar
                                                value={startDate}
                                                showTodayButton
                                                size="modal"
                                                onPickDate={(date) => {
                                                    setStartDate(date);
                                                    setIsStartDateOpen(false);
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div ref={startAmpmWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                                    <div className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`} onClick={() => setIsStartAmpmOpen((v) => !v)}>
                                        <span>{startAmpm ?? "오전"}</span>
                                        <img src={isStartAmpmOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </div>
                                    {isStartAmpmOpen && (
                                        <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                                            <div ref={startAmpmScrollRef} className={styles.selecteInner} role="listbox">
                                                {AMPM.map((ampm) => (
                                                    <div
                                                        key={ampm}
                                                        className={`${styles.selecteOption} ${startAmpm === ampm ? styles.selecteOptionActive : ""}`.trim()}
                                                        onClick={() => {
                                                            setStartAmpm(ampm);
                                                            setIsStartAmpmOpen(false);
                                                        }}
                                                    >
                                                        {ampm}
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
                                    <div className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`} onClick={() => setIsStartHourOpen((v) => !v)}>
                                        <span>{startHour ?? hourOptions[0]}</span>
                                        <img src={isStartHourOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </div>
                                    {isStartHourOpen && (
                                        <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                                            <div ref={startHourScrollRef} className={styles.selecteInner} role="listbox">
                                                {hourOptions.map((hour) => (
                                                    <div
                                                        key={hour}
                                                        className={`${styles.selecteOption} ${startHour === hour ? styles.selecteOptionActive : ""}`.trim()}
                                                        onClick={() => {
                                                            setStartHour(hour);
                                                            setIsStartHourOpen(false);
                                                        }}
                                                    >
                                                        {hour}
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
                                    <div className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`} onClick={() => setIsStartMinOpen((v) => !v)}>
                                        <span>{startMin ?? MINUTES[0]}</span>
                                        <img src={isStartMinOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </div>
                                    {isStartMinOpen && (
                                        <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                                            <div ref={startMinScrollRef} className={styles.selecteInner} role="listbox">
                                                {MINUTES.map((minute) => (
                                                    <div
                                                        key={minute}
                                                        className={`${styles.selecteOption} ${startMin === minute ? styles.selecteOptionActive : ""}`.trim()}
                                                        onClick={() => {
                                                            setStartMin(minute);
                                                            setIsStartMinOpen(false);
                                                        }}
                                                    >
                                                        {minute}
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
                        </div>
                        <div className={styles.itemBox}>
                            <div></div>
                            <div className={styles.itemDateBox}>
                                <div>종료</div>
                                <div ref={endDateWrapperRef} className={styles.itemDate}>
                                    {formatDate(endDate)}
                                    <img
                                        src="/icon/search_calendar.png"
                                        alt=""
                                        onClick={() => setIsEndDateOpen((v) => !v)}
                                    />
                                    {isEndDateOpen && (
                                        <div className={styles.calendarPopover}>
                                            <MiniCalendar
                                                value={endDate}
                                                showTodayButton
                                                size="modal"
                                                onPickDate={(date) => {
                                                    setEndDate(date);
                                                    setIsEndDateOpen(false);
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <div ref={endAmpmWrapperRef} className={`${styles.selecteWrapper} ${styles.selecteCompact}`}>
                                    <div className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`} onClick={() => setIsEndAmpmOpen((v) => !v)}>
                                        <span>{endAmpm ?? "오전"}</span>
                                        <img src={isEndAmpmOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </div>
                                    {isEndAmpmOpen && (
                                        <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                                            <div ref={endAmpmScrollRef} className={styles.selecteInner} role="listbox">
                                                {AMPM.map((ampm) => (
                                                    <div
                                                        key={ampm}
                                                        className={`${styles.selecteOption} ${endAmpm === ampm ? styles.selecteOptionActive : ""}`.trim()}
                                                        onClick={() => {
                                                            setEndAmpm(ampm);
                                                            setIsEndAmpmOpen(false);
                                                        }}
                                                    >
                                                        {ampm}
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
                                    <div className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`} onClick={() => setIsEndHourOpen((v) => !v)}>
                                        <span>{endHour ?? hourOptions[0]}</span>
                                        <img src={isEndHourOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </div>
                                    {isEndHourOpen && (
                                        <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                                            <div ref={endHourScrollRef} className={styles.selecteInner} role="listbox">
                                                {hourOptions.map((hour) => (
                                                    <div
                                                        key={hour}
                                                        className={`${styles.selecteOption} ${endHour === hour ? styles.selecteOptionActive : ""}`.trim()}
                                                        onClick={() => {
                                                            setEndHour(hour);
                                                            setIsEndHourOpen(false);
                                                        }}
                                                    >
                                                        {hour}
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
                                    <div className={`${styles.selecte} ${styles.selecteCompact} ${styles.timeSelecte}`} onClick={() => setIsEndMinOpen((v) => !v)}>
                                        <span>{endMin ?? MINUTES[0]}</span>
                                        <img src={isEndMinOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                    </div>
                                    {isEndMinOpen && (
                                        <div className={`${styles.selectebox} ${styles.selecteboxCompact}`}>
                                            <div ref={endMinScrollRef} className={styles.selecteInner} role="listbox">
                                                {MINUTES.map((minute) => (
                                                    <div
                                                        key={minute}
                                                        className={`${styles.selecteOption} ${endMin === minute ? styles.selecteOptionActive : ""}`.trim()}
                                                        onClick={() => {
                                                            setEndMin(minute);
                                                            setIsEndMinOpen(false);
                                                        }}
                                                    >
                                                        {minute}
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

                        <div className={styles.itemBox}>
                            <div>작업상태</div>
                            <div ref={workStatusWrapperRef} className={`${styles.selecteWrapper} ${styles.itemLeftMg}`}>
                                <div
                                className={styles.selecte}
                                onClick={() => setIsWorkStatusOpen((v) => !v)}
                                >
                                    <span>{selectedWorkStatus?.label ?? "작업상태 선택"}</span>
                                    <img
                                        src={isWorkStatusOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
                                        alt=""
                                    />
                                </div>

                                {isWorkStatusOpen && (
                                    <div className={styles.selectebox}>
                                        <div ref={statusScrollRef} className={styles.selecteInner} role="listbox">
                                            {WORK_STATUS.map((status) => (
                                                <div
                                                key={status.id}
                                                className={`${styles.selecteOption} ${selectedWorkStatus?.id === status.id ? styles.selecteOptionActive : ""}`.trim()}
                                                onClick={() => {
                                                    setSelectedWorkStatus(status);
                                                    setIsWorkStatusOpen(false);
                                                }}
                                                >
                                                {status.label}
                                                </div>
                                            ))}
                                        </div>

                                        {shouldShowWorkStatusScroll && (
                                            <div ref={statusTrackRef} className={styles.selecteScrollTrack}>
                                                <div ref={statusThumbRef} className={styles.selecteScrollThumb} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={styles.itemRadioBox}>
                            <div>반복설정</div>
                            <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`}>
                                <div
                                    className={styles.radioBtnBox}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => handleRepeatEnabled(true)}
                                >
                                    <img
                                        src={repeatEnabled ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                        alt=""
                                    />
                                    <span>반복</span>
                                </div>
                                <div
                                    className={styles.radioBtnBox}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => handleRepeatEnabled(false)}
                                >
                                    <img
                                        src={!repeatEnabled ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                        alt=""
                                    />
                                    <span>반복 안함</span>
                                </div>
                            </div>
                        </div>

                        {repeatEnabled && (
                            <>
                                <div className={styles.itemRadioBox}>
                                    <div>반복요일</div>
                                    <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`} style={{ gap: 10 }}>
                                        {DOWS.map((d) => {
                                            const active = repeatDays.includes(d);
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
                                                checked={repeatEveryday}
                                                onChange={(e) => toggleEveryday(e.target.checked)}
                                            />
                                            <span>매일</span>
                                        </label>
                                    </div>
                                </div>

                                <div className={styles.itemRadioBox}>
                                    <div>반복종료</div>
                                    <div className={`${styles.radioBtnFlex} ${styles.itemLeftMg}`}>
                                        <div
                                            className={styles.radioBtnBox}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setRepeatEndType("none")}
                                        >
                                            <img
                                                src={repeatEndType === "none" ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                                alt=""
                                            />
                                            <span>없음</span>
                                        </div>
                                        <div
                                            className={styles.radioBtnBox}
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => setRepeatEndType("date")}
                                            style={{ gap: 10 }}
                                        >
                                            <img
                                                src={repeatEndType === "date" ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                                alt=""
                                            />
                                            <span>종료 날짜</span>
                                        <div
                                            className={`${styles.repeatEndDateBox} ${
                                                repeatEndType !== "date" ? styles.repeatEndDateBoxDisabled : ""
                                            }`}
                                            ref={repeatEndDateWrapperRef}
                                        >
                                            <span className={styles.repeatEndDateText}>{repeatEndDate}</span>
                                            <img
                                                src="/icon/search_calendar.png"
                                                alt=""
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (repeatEndType === "date") {
                                                        setIsRepeatEndDateOpen((v) => !v);
                                                    }
                                                }}
                                            />
                                            {repeatEndType === "date" && isRepeatEndDateOpen && (
                                                <div
                                                    className={styles.calendarPopover}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <MiniCalendar
                                                        value={new Date(repeatEndDate)}
                                                        showTodayButton
                                                        size="modal"
                                                        onPickDate={(date) => {
                                                            setRepeatEndDate(formatDate(date));
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

                        <div className={`${styles.itemBox} ${styles.pathBox}`}>
                            <div>작업경로</div>
                            <div ref={workPathWrapperRef} className={styles.selecteWrapper}>
                                <div
                                className={styles.selecte}
                                onClick={() => setIsWorkPathOpen((v) => !v)}
                                >
                                    <span>{selectedWorkPath?.wayName ?? "경로명을 선택하세요"}</span>
                                    <img
                                        src={isWorkPathOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"}
                                        alt=""
                                    />
                                </div>

                                {isWorkPathOpen && (
                                <div className={styles.selectebox}>
                                    <div ref={pathScrollRef} className={styles.selecteInner} role="listbox">
                                    {workPathOptions.map((path) => (
                                        <div
                                        key={path.id}
                                        className={`${styles.selecteOption} ${selectedWorkPath?.id === path.id ? styles.selecteOptionActive : ""}`.trim()}
                                        onClick={() => {
                                            setSelectedWorkPath(path);
                                            setIsWorkPathOpen(false);
                                        }}
                                        >
                                        {path.wayName}
                                        </div>
                                    ))}
                                    </div>

                                    {shouldShowWorkPathScroll && (
                                        <div ref={pathTrackRef} className={styles.selecteScrollTrack}>
                                            <div ref={pathThumbRef} className={styles.selecteScrollThumb} />
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                        </div>
                        <div className={styles.pathBoxFlex}>
                            <div></div>
                            <button
                                className={`${styles.itemBoxBtn} ${styles.itemLeftMg}`}
                                type="button"
                                onClick={handleGoToPathManage}
                            >
                                작업경로 등록 화면  →
                            </button>
                        </div>
                                

                    </div>
                    <div className={styles.insertBtnTotal}>
                        <div className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`} onClick={handleCancel} >
                            <img src="/icon/close_btn.png" alt="cancel"/>
                            <div>취소</div>
                        </div>
                        <div className={`${styles.insertConfrimBtn} ${styles.btnBgBlue}`}  onClick={handleSave}>
                            <img src="/icon/check.png" alt="save" />
                            <div>저장</div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
    
}
