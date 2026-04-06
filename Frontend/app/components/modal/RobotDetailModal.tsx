'use client';

import styles from './Modal.module.css';
import React, { useState, useEffect, useRef } from 'react';
import type { RobotRowData } from '@/app/type';
import type { RobotDraft } from "@/app/(pages)/robots/components/RobotList";
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { apiFetch } from "@/app/lib/api";
import { useBatterySlider } from '@/app/hooks/useBatterySlider';
import { useAlertModal } from '@/app/hooks/useAlertModal';
import RobotWorkScheduleModal from "@/app/components/modal/WorkScheduleModal";
import type { WorkScheduleCase } from "@/app/components/modal/WorkScheduleModal";
import PlacePathModal from "@/app/components/modal/PlacePathModal";
import BatteryPathModal from "@/app/components/modal/BatteryChargeModal";
import PathMoveModal from "@/app/components/modal/PathMoveModal";
import { MapPin, Route } from "lucide-react";
import { getBatteryColor } from "@/app/constants/robotIcons";
import WaypointProgress from "@/app/components/common/WaypointProgress";
import type { WaypointStep } from "@/app/components/common/WaypointProgress";

type ActiveScheduleInfo = {
    id: number;
    RobotName: string;
    WorkName: string;
    TaskType: string;
    TaskStatus: string;
    WayName: string;
    StartDate: string;
    EndDate: string;
    Repeat: string;
    Repeat_Day: string | null;
    ScheduleMode?: string;
    ExecutionTime?: string | null;
    ActiveStartTime?: string | null;
    ActiveEndTime?: string | null;
    IntervalMinutes?: number | null;
};

type DetailModalProps = {
    isOpen: boolean;
    onClose: () => void;
    selectedRobotId: number | null;
    selectedRobot: RobotRowData | null;
    robots: RobotRowData[];
    initialEditMode?: boolean;
    activeSchedule?: ActiveScheduleInfo | null;

    persistedDraft?: RobotDraft;
    onPersistDraft?: (robotId: number, next: RobotDraft) => void;
}

export default function RobotDetailModal({
    isOpen,
    onClose,
    selectedRobotId,
    selectedRobot,
    robots,
    initialEditMode = false,
    activeSchedule = null,
}:DetailModalProps ){

    const [robotDetail, setRobotDetail] = useState<RobotRowData | null>(null);

    // B-1: 로딩 / 에러 상태
    const [isLoading, setIsLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!isOpen) return;
        if (selectedRobotId == null) return;
        if (!selectedRobot) return;

        setIsEditMode(initialEditMode);
        setIsLoading(true);
        setFetchError(null);

        apiFetch(`/DB/robots/${selectedRobotId}`)
            .then((res) => {
                if (!res.ok) {
                    throw new Error("로봇 상세 조회 실패");
                }
                return res.json();
            })
            .then((data) => {
                const limitBattery = data.LimitBattery ?? DEFAULT_RETURN_BATTERY;
                const detail = {
                    ...selectedRobot,
                    id: data.id ?? selectedRobot.id,
                    no: data.RobotName,
                    type: data.RobotType ?? selectedRobot.type,
                    operator: data.ProductCompany ?? selectedRobot.operator,
                    serialNumber: data.SerialNumber ?? selectedRobot.serialNumber,
                    model: data.ModelName ?? selectedRobot.model,
                    group: data.Group ?? selectedRobot.group,
                    softwareVersion: data.SWversion ?? selectedRobot.softwareVersion,
                    site: data.Site ?? selectedRobot.site,
                    registrationDateTime: data.Adddate ?? selectedRobot.registrationDateTime,
                    return: data.LimitBattery ?? selectedRobot.return ?? DEFAULT_RETURN_BATTERY,
                    robotIP: data.RobotIP ?? selectedRobot.robotIP,
                    robotPort: data.RobotPort ?? selectedRobot.robotPort,
                    };

                setRobotDetail(detail);

                setDraft({
                    robotName: detail.no,
                    operator: detail.operator,
                    serialNumber: detail.serialNumber,
                    model: detail.model,
                    group: detail.group,
                    softwareVersion: detail.softwareVersion,
                    site: detail.site,
                    registrationDateTime: detail.registrationDateTime,
                    returnBattery: detail.return ?? DEFAULT_RETURN_BATTERY,
                    });
                // 배터리 UI 동기화
                battery.reset(limitBattery);
            })
            .catch((err) => {
                console.error("robot detail fetch error:", err);
                setFetchError("로봇 정보를 불러오는 데 실패했습니다.");
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [isOpen, selectedRobotId]);


    const [showConfirm, setShowConfirm] = useState(false);

    const [saveSuccessOpen, setSaveSuccessOpen] = useState(false);

    // B-3: API 에러 알림창 (alert 대체)
    const apiAlert = useAlertModal();

    const [isEditMode, setIsEditMode] = useState(initialEditMode);

    // B-4: 저장/삭제 중복 제출 방지
    const [isSubmitting, setIsSubmitting] = useState(false);

    const DEFAULT_RETURN_BATTERY = 30;

    type RobotDraft = {
    robotName: string;
    operator: string;
    serialNumber: string;
    model: string;
    group: string;
    softwareVersion: string;
    site: string;
    registrationDateTime: string;
    returnBattery: number;
    };

    const [draft, setDraft] = useState<RobotDraft>({
    robotName: "",
    operator: "",
    serialNumber: "",
    model: "",
    group: "",
    softwareVersion: "",
    site: "",
    registrationDateTime: "",
    returnBattery: DEFAULT_RETURN_BATTERY,
    });

    const battery = useBatterySlider({ min: 15, max: 30, defaultValue: DEFAULT_RETURN_BATTERY });

    // 운영사 드롭다운 (편집 모드)
    const [bizList, setBizList] = useState<{ id: number; name: string }[]>([]);
    const [bizDropdownOpen, setBizDropdownOpen] = useState(false);
    const bizDropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isEditMode) { setBizDropdownOpen(false); return; }
        apiFetch(`/DB/businesses?size=10000`)
            .then(res => { if (!res.ok) throw new Error(); return res.json(); })
            .then(data => {
                const items = (data.items ?? []).map((b: any) => ({ id: b.id, name: b.BusinessName }));
                setBizList(items);
            })
            .catch(() => setBizList([]));
    }, [isEditMode]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (bizDropdownRef.current && !bizDropdownRef.current.contains(e.target as Node)) {
                setBizDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Action modal states
    const [workScheduleModalOpen, setWorkScheduleModalOpen] = useState(false);
    const [placePathModalOpen, setPlacePathModalOpen] = useState(false);
    const [pathMoveModalOpen, setPathMoveModalOpen] = useState(false);
    const [batteryConfirmOpen, setBatteryConfirmOpen] = useState(false);

    // Work schedule states
    const [workScheduleCase, setWorkScheduleCase] = useState<WorkScheduleCase>('none');
    const [completedPathText, setCompletedPathText] = useState<string>('');
    const [workScheduleLoading, setWorkScheduleLoading] = useState(false);
    const [workScheduleError, setWorkScheduleError] = useState<string | null>(null);

    // Path data (lazy loaded)
    const [pathRows, setPathRows] = useState<any[]>([]);

    // B-9: ESC 키 동작 - 수정 모드에서는 보기 모드로 전환, 보기 모드에서는 모달 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (isSubmitting) return;
                if (isEditMode) {
                    if (initialEditMode) {
                        onClose();
                    } else {
                        handleCancel();
                    }
                } else {
                    onClose();
                }
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden'; // 스크롤 방지
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
        }, [isOpen, onClose, isEditMode, isSubmitting]);

    if (!isOpen) return null;
    if (!selectedRobot) return null;

    // 삭제 버튼 클릭 핸들러
    const handleDelete = () => {
      setShowConfirm(true);   // 커스텀 confirm 열기
    };

    // 삭제 재 확인 창 - confirm 창에서 확인 눌렀을 때
    const handleConfirmOk = async () => {
        if (!selectedRobotId) return;
        if (isSubmitting) return;

        setIsSubmitting(true);
        try {
            const res = await apiFetch(
            `/DB/robots/${selectedRobotId}`,
            { method: "DELETE" }
            );

            if (!res.ok) {
            throw new Error("로봇 삭제 실패");
            }

            setShowConfirm(false);
            onClose();
            window.location.reload();
        } catch (err) {
            console.error("robot delete error:", err);
            setShowConfirm(false);
            apiAlert.show("로봇 삭제에 실패했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

     // 삭제 재 확인 창 - confirm 창만 닫기
    const handleConfirmCancel = () => {
      setShowConfirm(false);
    };

    const handleUdate = () => {
        setIsEditMode(true);
    };


    const handleCancel = () => {
    // 목록에서 수정 버튼으로 진입한 경우 → 모달 닫기
    if (initialEditMode) {
        onClose();
        return;
    }

    // 상세보기에서 수정 진입한 경우 → 보기모드로 전환
    // 1) 선택 로봇 값으로 draft 되돌리기
    const rb =
        ((robotDetail ?? selectedRobot) as any)?.returnBattery ??
        ((robotDetail ?? selectedRobot) as any)?.return ??
        DEFAULT_RETURN_BATTERY;

    setDraft({
        robotName: (robotDetail ?? selectedRobot)?.no ?? "",
        operator: (robotDetail ?? selectedRobot)?.operator ?? "",
        serialNumber: (robotDetail ?? selectedRobot)?.serialNumber ?? "",
        model: (robotDetail ?? selectedRobot)?.model ?? "",
        group: (robotDetail ?? selectedRobot)?.group ?? "",
        softwareVersion: (robotDetail ?? selectedRobot)?.softwareVersion ?? "",
        site: (robotDetail ?? selectedRobot)?.site ?? "",
        registrationDateTime: (robotDetail ?? selectedRobot)?.registrationDateTime ?? "",
        returnBattery: typeof rb === "number" ? rb : DEFAULT_RETURN_BATTERY,
    });

    // 2) 배터리 입력 UI도 원복
    battery.commitByNumber(typeof rb === "number" ? rb : DEFAULT_RETURN_BATTERY);

    // 3) 모달 닫지 않고 "보기모드"로만 전환
    setIsEditMode(false);
    };

    const handleSave = async () => {
        if (isSubmitting) return;

        // 필수값 유효성 검증
        const requiredFields = {
            robotName: "로봇명",
            model: "모델",
            serialNumber: "시리얼 번호",
            operator: "운영사",
        } as const;

        const errors: Record<string, boolean> = {};
        for (const [key, label] of Object.entries(requiredFields)) {
            if (!(draft[key as keyof typeof draft] as string).trim()) {
                errors[key] = true;
            }
        }

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors);
            return;
        }
        setFieldErrors({});

        const ok = battery.validateAndFix();
        if (!ok) return;

        const rb = battery.value;

        const payload = {
            robotName: draft.robotName,
            operator: draft.operator,
            serialNumber: draft.serialNumber,
            model: draft.model,
            group: draft.group,
            softwareVersion: draft.softwareVersion,
            site: draft.site,
            limit_battery: rb,
        };

        setIsSubmitting(true);
        try {
            const res = await apiFetch(
            `/DB/robots/${selectedRobotId}`,
            {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            }
            );

            if (!res.ok) throw new Error("로봇 정보 수정 실패");

            // 1. 화면에 쓰이는 robotDetail 갱신
            setRobotDetail((prev) =>
            prev
                ? {
                    ...prev,
                    no: payload.robotName,
                    operator: payload.operator,
                    serialNumber: payload.serialNumber,
                    model: payload.model,
                    group: payload.group,
                    softwareVersion: payload.softwareVersion,
                    site: payload.site,
                    return: rb,
                }
                : prev
            );

            // 2. draft도 동기화
            setDraft((p) => ({ ...p, returnBattery: rb }));

            // 3. 보기모드 전환
            setIsEditMode(false);

            // 4. 저장 완료 알림
            setSaveSuccessOpen(true);
        } catch (err) {
            console.error("robot update error:", err);
            apiAlert.show("로봇 정보 저장에 실패했습니다.");
        } finally {
            setIsSubmitting(false);
        }
    };

    // 작업일정 복귀 핸들러
    const openWorkScheduleModal = async () => {
      if (!selectedRobotId) return;
      const robotName = (robotDetail ?? selectedRobot)?.no ?? '';
      setWorkScheduleLoading(true);
      setWorkScheduleModalOpen(true);
      setWorkScheduleError(null);

      try {
        const res = await apiFetch(`/DB/schedule`);
        if (!res.ok) throw new Error('스케줄 조회 실패');
        const schedules = await res.json();
        const robotSchedules = schedules.filter((s: any) => s.RobotName === robotName);

        const ongoing = robotSchedules.find((s: any) => s.TaskStatus === '진행');
        if (ongoing) {
          setWorkScheduleCase('ongoing');
          setCompletedPathText(ongoing.WayName ?? '');
          return;
        }

        const completed = robotSchedules
          .filter((s: any) => s.TaskStatus === '완료')
          .sort((a: any, b: any) => new Date(b.EndDate).getTime() - new Date(a.EndDate).getTime());
        if (completed.length > 0) {
          setWorkScheduleCase('recent');
          setCompletedPathText(completed[0].WayName ?? '');
          return;
        }

        setWorkScheduleCase('none');
        setCompletedPathText('');
      } catch (err) {
        console.error(err);
        setWorkScheduleError('작업일정을 불러오지 못했습니다.');
        setWorkScheduleCase('none');
      } finally {
        setWorkScheduleLoading(false);
      }
    };

    // 경로 이동용 path 데이터 lazy fetch
    const fetchPathRows = async () => {
      try {
        const res = await apiFetch(`/DB/getpath`);
        if (!res.ok) throw new Error("경로 목록 조회 실패");
        const data = await res.json();
        setPathRows(data.map((p: any) => ({
          id: p.id,
          robotNo: p.RobotName,
          workType: p.TaskType,
          pathName: p.WayName,
          pathOrder: p.WayPoints,
          updatedAt: p.UpdateTime ? new Date(p.UpdateTime).toLocaleString("ko-KR") : "-",
        })));
      } catch (err) {
        console.error("경로 목록 로드 실패", err);
      }
    };

    const openPathMoveModal = () => {
      if (pathRows.length === 0) fetchPathRows();
      setPathMoveModalOpen(true);
    };

    // 충전소 이동 핸들러
    const handleChargeMove = () => {
      setBatteryConfirmOpen(true);
    };

    const handleChargeMoveConfirm = () => {
      if (!selectedRobotId) return;
      console.log("충전소 이동:", selectedRobotId);
      // TODO: API call
      setBatteryConfirmOpen(false);
    };

    return (
        <>
        <div className={styles.modalOverlay} onClick={isSubmitting ? undefined : onClose}>
            <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>

                {/* ── Header ── */}
                <div className={styles.detailHeader} style={isEditMode ? { paddingBottom: 0 } : undefined}>
                  <div className={styles.detailHeaderTop}>
                    <h2>{(robotDetail ?? selectedRobot)?.no ?? "로봇"} {isEditMode ? "수정" : "상세정보"}</h2>
                    <button className={styles.detailCloseBtn} onClick={onClose} disabled={isSubmitting} aria-label="닫기">✕</button>
                  </div>
                </div>

                {/* ── Body ── */}
                <div className={styles.detailBody} style={isEditMode ? { paddingTop: 0 } : undefined}>

                {/* B-1: 로딩 상태 */}
                {isLoading && (
                    <div className={styles.detailLoadingWrap}>
                        <div className={styles.detailSpinner} />
                        <span>로봇 정보를 불러오는 중...</span>
                    </div>
                )}

                {/* B-2: fetch 에러 상태 */}
                {!isLoading && fetchError && (
                    <div className={styles.detailErrorWrap}>
                        <span>{fetchError}</span>
                        <button
                            type="button"
                            className={`${styles.btnItemCommon} ${styles.btnBgGray}`}
                            onClick={() => {
                                setFetchError(null);
                                setIsLoading(true);
                                apiFetch(`/DB/robots/${selectedRobotId}`)
                                    .then(res => { if (!res.ok) throw new Error(); return res.json(); })
                                    .then(data => {
                                        const limitBattery = data.LimitBattery ?? DEFAULT_RETURN_BATTERY;
                                        const detail = {
                                            ...selectedRobot,
                                            id: data.id ?? selectedRobot.id,
                                            no: data.RobotName,
                                            type: data.RobotType ?? selectedRobot.type,
                                            operator: data.ProductCompany ?? selectedRobot.operator,
                                            serialNumber: data.SerialNumber ?? selectedRobot.serialNumber,
                                            model: data.ModelName ?? selectedRobot.model,
                                            group: data.Group ?? selectedRobot.group,
                                            softwareVersion: data.SWversion ?? selectedRobot.softwareVersion,
                                            site: data.Site ?? selectedRobot.site,
                                            registrationDateTime: data.Adddate ?? selectedRobot.registrationDateTime,
                                            return: data.LimitBattery ?? selectedRobot.return ?? DEFAULT_RETURN_BATTERY,
                                            robotIP: data.RobotIP ?? selectedRobot.robotIP,
                                            robotPort: data.RobotPort ?? selectedRobot.robotPort,
                                        };
                                        setRobotDetail(detail);
                                        setDraft({
                                            robotName: detail.no,
                                            operator: detail.operator, serialNumber: detail.serialNumber,
                                            model: detail.model, group: detail.group,
                                            softwareVersion: detail.softwareVersion, site: detail.site,
                                            registrationDateTime: detail.registrationDateTime,
                                            returnBattery: detail.return ?? DEFAULT_RETURN_BATTERY,
                                        });
                                        battery.reset(limitBattery);
                                    })
                                    .catch(() => setFetchError("로봇 정보를 불러오는 데 실패했습니다."))
                                    .finally(() => setIsLoading(false));
                            }}
                        >
                            <span>다시 시도</span>
                        </button>
                    </div>
                )}

                {/* 데이터 로드 완료 시 표시 */}
                {!isLoading && !fetchError && (
                <>
                {/* ── 실시간 현황 섹션 ── */}
                {!isEditMode && (() => {
                  const r = robotDetail ?? selectedRobot;
                  if (!r) return null;
                  const isOffline = r.power === "Off";
                  const isNetworkDown = r.network === "Offline" && !isOffline;

                  // 상태 계산
                  let statusLabel = "대기";
                  let statusClass = styles.detailBadgeStandby;
                  if (isOffline) { statusLabel = "오프라인"; statusClass = styles.detailBadgeOffline; }
                  else if (r.isCharging) { statusLabel = "충전"; statusClass = styles.detailBadgeCharging; }
                  else if (r.tasks.length > 0 && r.waitingTime === 0) { statusLabel = "운영"; statusClass = styles.detailBadgeOperating; }

                  // 네트워크 dot
                  const netDotClass = r.network === "Online" ? styles.detailNetDotOnline
                    : r.network === "Error" ? styles.detailNetDotError
                    : styles.detailNetDotOffline;

                  // 배터리 색상
                  const bat = r.battery ?? 0;
                  const limitBat = r.return ?? 30;

                  return (
                    <div className={`${styles.detailStatusSection} ${isOffline ? styles.detailStatusOffline : ""}`}>
                      <h3 className={styles.detailSectionTitle}>실시간 현황</h3>
                      {isNetworkDown && (
                        <div className={styles.detailNetworkWarning}>통신 끊김 — 마지막 수신 데이터 기준</div>
                      )}
                      <div className={styles.detailStatusGrid}>
                        <div className={styles.detailStatusItem}>
                          <span className={styles.detailStatusLabel}>상태</span>
                          <span className={`${styles.detailStatusValue} ${statusClass}`}>{statusLabel}</span>
                        </div>
                        <div className={styles.detailStatusItem}>
                          <span className={styles.detailStatusLabel}>전원</span>
                          <span className={styles.detailStatusValue}>{r.power ?? "-"}</span>
                        </div>
                        <div className={styles.detailStatusItem}>
                          <span className={styles.detailStatusLabel}>네트워크</span>
                          <span className={styles.detailStatusValue}>{r.network ?? "-"}</span>
                        </div>
                        <div className={styles.detailStatusItem}>
                          <span className={styles.detailStatusLabel}>배터리</span>
                          <span className={styles.detailStatusValue}>
                            {isOffline ? "-" : (
                              r.type === "QUADRUPED" ? (
                                <>
                                  L {r.batteryLeft != null ? (
                                    <span style={{ color: getBatteryColor(r.batteryLeft, limitBat) }}>{r.batteryLeft}%</span>
                                  ) : <span>-</span>}
                                  <span style={{ color: "var(--text-muted)" }}> / </span>
                                  R {r.batteryRight != null ? (
                                    <span style={{ color: getBatteryColor(r.batteryRight, limitBat) }}>{r.batteryRight}%</span>
                                  ) : <span>-</span>}
                                </>
                              ) : (
                                <span style={{ color: getBatteryColor(bat, limitBat) }}>{bat}%</span>
                              )
                            )}
                          </span>
                        </div>
                        <div className={styles.detailStatusItem}>
                          <span className={styles.detailStatusLabel}>현재 위치</span>
                          <span className={styles.detailStatusValue}>
                            {isOffline ? "-" : (r.site || "-")}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── 기본 정보 (2열 그리드) ── */}
                {(() => {
                  const r = robotDetail ?? selectedRobot;
                  const isRobotOffline = r?.power === "Off";

                  if (isEditMode) {
                    return (
                      <>
                        <div className={styles.itemBoxContainer}>
                          {/* 로봇명 */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>로봇명 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                              <input type="text" maxLength={20} value={draft.robotName}
                                onChange={e => { setDraft(p => ({...p, robotName: e.target.value})); if (fieldErrors.robotName) setFieldErrors(p => ({...p, robotName: false})); }}
                                placeholder="20글자 이내로 작성해 주세요."
                                className={fieldErrors.robotName ? styles.inputError : ""} />
                              {fieldErrors.robotName && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
                            </div>
                          </div>
                          {/* 모델 */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>모델 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                              <input type="text" maxLength={20} value={draft.model as string}
                                onChange={e => { setDraft(p => ({...p, model: e.target.value})); if (fieldErrors.model) setFieldErrors(p => ({...p, model: false})); }}
                                placeholder="20글자 이내로 작성해 주세요."
                                className={fieldErrors.model ? styles.inputError : ""} />
                              {fieldErrors.model && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
                            </div>
                          </div>
                          {/* 시리얼 번호 */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>시리얼 번호 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                              <input type="text" maxLength={20} value={draft.serialNumber as string}
                                onChange={e => { setDraft(p => ({...p, serialNumber: e.target.value})); if (fieldErrors.serialNumber) setFieldErrors(p => ({...p, serialNumber: false})); }}
                                placeholder="20글자 이내로 작성해 주세요."
                                className={fieldErrors.serialNumber ? styles.inputError : ""} />
                              {fieldErrors.serialNumber && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
                            </div>
                          </div>
                          {/* 운영사 */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>운영사 <span className={styles.requiredMark}>*</span></div>
                            <div className={styles.insertInputWrap}>
                              <div ref={bizDropdownRef} className={styles.customSelectWrap}>
                                <button
                                  type="button"
                                  className={`${styles.customSelectTrigger} ${fieldErrors.operator ? styles.inputError : ""}`}
                                  onClick={() => setBizDropdownOpen(prev => !prev)}
                                  aria-label="운영사"
                                >
                                  <span style={{ color: draft.operator ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                                    {draft.operator || "운영사를 선택하세요"}
                                  </span>
                                  <img className={styles.customSelectArrow} src={bizDropdownOpen ? "/icon/arrow_up.png" : "/icon/arrow_down.png"} alt="" />
                                </button>
                                {bizDropdownOpen && (
                                  <div className={styles.customSelectDropdown}>
                                    {bizList.length === 0 ? (
                                      <div className={styles.customSelectItem} style={{ color: "var(--text-muted)" }}>등록된 사업자가 없습니다</div>
                                    ) : (
                                      bizList.map((b) => (
                                        <div
                                          key={b.id}
                                          className={`${styles.customSelectItem} ${draft.operator === b.name ? styles.customSelectItemActive : ""}`}
                                          onClick={() => {
                                            setDraft(p => ({ ...p, operator: b.name }));
                                            setBizDropdownOpen(false);
                                            if (fieldErrors.operator) setFieldErrors(p => ({ ...p, operator: false }));
                                          }}
                                        >
                                          {b.name}
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                              {fieldErrors.operator && <div className={styles.errorMessage}>필수 선택 항목입니다.</div>}
                            </div>
                          </div>
                          {/* 사이트 (읽기 전용) */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>사이트</div>
                            <div className={styles.insertInputWrap}>
                              <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", lineHeight: "36px" }}>{r?.site ?? "-"}</span>
                            </div>
                          </div>
                          {/* S/W 버전 (읽기 전용) */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>S/W 버전</div>
                            <div className={styles.insertInputWrap}>
                              <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", lineHeight: "36px" }}>{r?.softwareVersion ?? "-"}</span>
                            </div>
                          </div>
                          {/* 복귀 배터리양 */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>복귀 배터리양 <span className={styles.batteryCurrentValue}>{battery.value}%</span></div>
                            <div className={styles.batterySliderWrap}>
                              <div className={styles.batterySliderTrackArea}>
                                <input className={styles.batterySlider} type="range"
                                  min={battery.min} max={battery.max} step={1}
                                  value={battery.value} onChange={battery.handleSliderChange}
                                  aria-label="복귀 배터리양 조정"
                                  style={{ ['--percent' as any]: `${battery.sliderPercent}%` }} />
                              </div>
                              <div className={styles.batterySliderLabels}>
                                <span>{battery.min}%</span>
                                <span>{battery.max}%</span>
                              </div>
                            </div>
                          </div>
                          {/* 등록일시 (읽기 전용) */}
                          <div className={styles.insertItemBox}>
                            <div className={styles.insertItemLabel}>등록일시</div>
                            <div className={styles.batterySliderWrap}>
                              <div style={{ height: 20, display: "flex", alignItems: "center" }}>
                                <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)" }}>{r?.registrationDateTime?.replace("T", " ") ?? "-"}</span>
                              </div>
                              <div style={{ height: 18 }} />
                            </div>
                          </div>
                        </div>
                        {/* 버튼 - 등록 모달과 동일 스타일 */}
                        <div className={styles.insertBtnTotal}>
                          <button type="button" className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`}
                            onClick={handleCancel} disabled={isSubmitting}>
                            <img src="/icon/close_btn.png" alt="cancel"/>
                            <span>취소</span>
                          </button>
                          <button type="button" className={`${styles.insertConfrimBtn} ${styles.btnBgBlue} ${isSubmitting ? styles.btnDisabled : ""}`}
                            onClick={handleSave} disabled={isSubmitting}>
                            {isSubmitting ? <div className={styles.btnSpinner} /> : <img src="/icon/check.png" alt="save" style={{ verticalAlign: "middle", flexShrink: 0 }} />}
                            <span style={{ lineHeight: 1 }}>{isSubmitting ? "저장 중..." : "저장"}</span>
                          </button>
                        </div>
                      </>
                    );
                  }

                  // 보기 모드
                  const infoField = (label: string, field: keyof typeof draft | null, value: string, readonly?: boolean) => {
                    return (
                      <div className={styles.detailInfoRow}>
                        <span className={styles.detailInfoLabel}>
                          {label}
                        </span>
                        <span className={styles.detailInfoValue}>
                          {value}
                        </span>
                      </div>
                    );
                  };

                  return (
                    <div className={styles.detailInfoSection}>
                      <h3 className={styles.detailSectionTitle}>기본 정보</h3>
                      <div className={styles.detailInfoGrid}>
                        {infoField("로봇명", "robotName",
                          r?.no ?? "-")}
                        {infoField("모델", "model",
                          r?.model ?? "-")}
                        {infoField("시리얼 번호", "serialNumber",
                          r?.serialNumber ?? "-")}
                        {infoField("운영사", "operator",
                          r?.operator ?? "-")}
                        {infoField("로봇 타입", null,
                          r?.type ?? "-", true)}
                        {infoField("사이트", "site",
                          r?.site ?? "-", true)}
                        {infoField("S/W 버전", "softwareVersion",
                          r?.softwareVersion ?? "-", true)}
                        {infoField("로봇 IP", null,
                          r?.robotIP ?? "-", true)}
                        {infoField("로봇 Port", null,
                          r?.robotPort != null ? String(r.robotPort) : "-", true)}

                        {/* 복귀 배터리 (좌) / 등록일시 (우) */}
                        <div className={styles.detailInfoRow}>
                          <span className={styles.detailInfoLabel}>복귀 배터리</span>
                          <span className={styles.detailInfoValue}>
                            <div className={styles.detailBatteryView}>
                              <span className={styles.detailBatteryBar}>
                                <span className={styles.detailBatteryFill} style={{ width: `${Math.min(draft.returnBattery, 100)}%` }} />
                              </span>
                              <span>{draft.returnBattery}%</span>
                            </div>
                          </span>
                        </div>
                        {infoField("등록일시", null,
                          r?.registrationDateTime?.replace("T", " ") ?? "-", true)}
                      </div>

                      {/* 액션 버튼 (기본정보 섹션 내부) */}
                      <div className={styles.detailActionBar}>
                        <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ""}`}
                          onClick={isRobotOffline ? undefined : openWorkScheduleModal} disabled={!!isRobotOffline}>
                          <img src="/icon/robot_schedule_w.png" alt="" style={{ height: 13 }} />
                          <span>작업 복귀</span>
                        </button>
                        <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ""}`}
                          onClick={isRobotOffline ? undefined : () => setPlacePathModalOpen(true)} disabled={!!isRobotOffline}>
                          <MapPin size={14} />
                          <span>장소 이동</span>
                        </button>
                        <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ""}`}
                          onClick={isRobotOffline ? undefined : openPathMoveModal} disabled={!!isRobotOffline}>
                          <Route size={14} />
                          <span>경로 이동</span>
                        </button>
                        <button type="button" className={`${styles.btnItemCommon} ${styles.btnBgGray} ${isRobotOffline ? styles.btnDisabled : ""}`}
                          onClick={isRobotOffline ? undefined : handleChargeMove} disabled={!!isRobotOffline}>
                          <img src="/icon/robot_battery_place_w.png" alt="" style={{ height: 13 }} />
                          <span>충전소 이동</span>
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── 현재 작업 섹션 ── */}
                {!isEditMode && (() => {
                  const r = robotDetail ?? selectedRobot;
                  if (!r) return null;
                  const isOffline = r.power === "Off";

                  if (isOffline) {
                    return (
                      <div className={styles.detailTaskSection}>
                        <h3 className={styles.detailSectionTitle}>현재 작업</h3>
                        <div className={styles.detailTaskEmpty}>오프라인 — 작업 할당 불가</div>
                      </div>
                    );
                  }

                  if (!activeSchedule) {
                    return (
                      <div className={styles.detailTaskSection}>
                        <h3 className={styles.detailSectionTitle}>현재 작업</h3>
                        <div className={styles.detailTaskEmpty}>진행 중인 작업 없음</div>
                      </div>
                    );
                  }

                  const as = activeSchedule;
                  const mode = as.ScheduleMode || (as.Repeat === "Y" ? "weekly" : "once");
                  const modeLabel = mode === "weekly" ? "요일반복" : mode === "interval" ? "주기반복" : "단일";

                  const fmt = (d: string) => {
                    const dt = new Date(d);
                    return `${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
                  };
                  let timeText = "";
                  let modeInfo = "";
                  // 요일반복 다중시각: 각 시각별 상태 배열
                  type TimeSlot = { str: string; min: number; status: "done" | "active" | "waiting" };
                  let timeSlots: TimeSlot[] | null = null;

                  if (mode === "interval") {
                    timeText = `${as.ActiveStartTime || fmt(as.StartDate)} ~ ${as.ActiveEndTime || fmt(as.EndDate)}`;
                    const days = as.Repeat_Day ? (as.Repeat_Day === "월,화,수,목,금,토,일" ? "매일" : `매주 ${as.Repeat_Day}`) : "";
                    modeInfo = `${days} ${as.IntervalMinutes ?? 0}분 간격`.trim();
                  } else if (mode === "weekly") {
                    const days = as.Repeat_Day === "월,화,수,목,금,토,일" ? "매일" : as.Repeat_Day ? `매주 ${as.Repeat_Day}` : "";
                    if (as.ExecutionTime) {
                      const now = new Date();
                      const nowMin = now.getHours() * 60 + now.getMinutes();
                      const timeMins = as.ExecutionTime.split(",").map((t: string) => {
                        const [h, m] = t.trim().split(":").map(Number);
                        return { min: h * 60 + m, str: t.trim() };
                      }).sort((a, b) => a.min - b.min);

                      // 현재 실행 중인 시각 인덱스
                      let currentIdx = -1;
                      for (let i = timeMins.length - 1; i >= 0; i--) {
                        if (timeMins[i].min <= nowMin) { currentIdx = i; break; }
                      }

                      timeSlots = timeMins.map((t, i) => ({
                        ...t,
                        status: i < currentIdx ? "done" as const
                          : i === currentIdx ? "active" as const
                          : "waiting" as const,
                      }));
                      modeInfo = days;
                    } else {
                      timeText = fmt(as.StartDate);
                      modeInfo = days;
                    }
                  } else {
                    timeText = fmt(as.StartDate);
                  }

                  return (
                    <div className={styles.detailTaskSection}>
                      <h3 className={styles.detailSectionTitle}>현재 작업</h3>
                      <div className={styles.detailTaskCard}>
                        <div className={styles.detailTaskHeader}>
                          <span className={styles.detailTaskName}>{as.WorkName}</span>
                          <span className={styles.detailTaskType}>{as.TaskType}</span>
                          <span className={styles.detailTaskMode} data-mode={mode}>{modeLabel}</span>
                          <span className={styles.detailTaskStatus}>{as.TaskStatus}</span>
                        </div>
                        {timeSlots ? (
                          <>
                            <div className={styles.detailTimeSlots}>
                              {timeSlots.map((slot, i) => (
                                <span key={i} className={`${styles.detailTimeSlot} ${styles[`detailTimeSlot_${slot.status}`]}`}>
                                  <span className={styles.detailTimeSlotIcon}>
                                    {slot.status === "done" ? "✓" : slot.status === "active" ? "▶" : "·"}
                                  </span>
                                  {slot.str}
                                </span>
                              ))}
                            </div>
                            {modeInfo && (
                              <div className={styles.detailTaskInfo}>
                                <span className={styles.detailTaskInfoItem}>{modeInfo}</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className={styles.detailTaskInfo}>
                            <span className={styles.detailTaskInfoItem}>{timeText}</span>
                            {modeInfo && <span className={styles.detailTaskInfoItem}>{modeInfo}</span>}
                          </div>
                        )}
                        <div className={styles.detailTaskInfo}>
                          <span className={styles.detailTaskInfoItem}>작업 경로: {as.WayName}</span>
                        </div>
                      </div>
                    </div>
                  );
                })()}


                </>
                )}
                </div>
                {/* ── Body 끝 ── */}

            </div>
        </div>
        {showConfirm && (
            <CancelConfirmModal
            message="해당 로봇을 정말 삭제 하시겠습니까?"
            onConfirm={handleConfirmOk}
            onCancel={handleConfirmCancel}
            />
        )}
        {battery.alertOpen && (
            <CancelConfirmModal
                message={battery.alertMsg}
                onConfirm={battery.closeAlert}
                onCancel={battery.closeAlert}
            />
        )}
        {saveSuccessOpen && (
            <CancelConfirmModal
                message="저장되었습니다."
                onConfirm={() => setSaveSuccessOpen(false)}
                onCancel={() => setSaveSuccessOpen(false)}
            />
        )}
        {apiAlert.isOpen && (
            <CancelConfirmModal
                message={apiAlert.message}
                onConfirm={apiAlert.close}
                onCancel={apiAlert.close}
            />
        )}
        {workScheduleModalOpen && (
          <RobotWorkScheduleModal
            isOpen={workScheduleModalOpen}
            onClose={() => { setWorkScheduleModalOpen(false); setWorkScheduleError(null); }}
            selectedRobotIds={selectedRobotId ? [selectedRobotId] : []}
            scheduleCase={workScheduleCase}
            completedPathText={completedPathText}
            loading={workScheduleLoading}
            error={workScheduleError}
            onConfirmReturn={() => {
              const robotName = (robotDetail ?? selectedRobot)?.no ?? '';
              apiFetch(`/nav/startmove`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ robotName, action: "schedule_return" }),
              }).catch((err) => console.error("작업일정 복귀 명령 실패", err));
            }}
            onConfirmWhenNone={() => {
              window.location.href = "/schedules";
            }}
            onRetry={openWorkScheduleModal}
          />
        )}
        {placePathModalOpen && (
          <PlacePathModal
            isOpen={placePathModalOpen}
            onClose={() => setPlacePathModalOpen(false)}
            selectedRobotIds={selectedRobotId ? [selectedRobotId] : []}
          />
        )}
        {pathMoveModalOpen && (
          <PathMoveModal
            isOpen={pathMoveModalOpen}
            onClose={() => setPathMoveModalOpen(false)}
            robotName={(robotDetail ?? selectedRobot)?.no ?? ''}
            pathRows={pathRows}
            onConfirm={async (path) => {
              try {
                const res = await apiFetch(`/nav/pathmove/${path.id}`, { method: "POST" });
                const data = await res.json();
                console.log("경로 이동 명령 전송:", data.msg ?? data.status);
              } catch (err) {
                console.error("경로 이동 실패:", err);
              }
              setPathMoveModalOpen(false);
            }}
          />
        )}
        {batteryConfirmOpen && (
          <BatteryPathModal
            isOpen={batteryConfirmOpen}
            message="배터리 충전소로 이동하시겠습니까?"
            onConfirm={handleChargeMoveConfirm}
            onCancel={() => setBatteryConfirmOpen(false)}
          />
        )}
        </>
    );

}
