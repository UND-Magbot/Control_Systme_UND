'use client';

import styles from '@/app/components/modal/Modal.module.css';
import React, { useState, useEffect, useRef } from 'react';
import type { RobotRowData } from '@/app/types';
import type { RobotDraft } from "./RobotManageTab";
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import ConfirmOnlyModal from '@/app/components/modal/ConfirmOnlyModal';
import { apiFetch } from "@/app/lib/api";
import { useBatterySlider } from '@/app/hooks/useBatterySlider';
import { useAlertModal } from '@/app/hooks/useAlertModal';
import RobotWorkScheduleModal from "@/app/(pages)/operationManagement/components/tabs/robot/WorkScheduleModal";
import type { WorkScheduleCase } from "@/app/(pages)/operationManagement/components/tabs/robot/WorkScheduleModal";
import PlacePathModal from "@/app/components/modal/PlacePathModal";
import BatteryPathModal from "@/app/components/modal/BatteryChargeModal";
import PathMoveModal from "@/app/(pages)/operationManagement/components/tabs/robot/PathMoveModal";
import { MapPin, Route, Pencil } from "lucide-react";
import { getBatteryColor } from "@/app/constants/robotIcons";
import ChargingIcon from "@/app/components/common/ChargingIcon";
import WaypointProgress from "./WaypointProgress";
import type { WaypointStep } from "./WaypointProgress";
import RobotActiveScheduleSection, { type ActiveScheduleInfo } from "./RobotActiveScheduleSection";
import RobotRealtimeStatusSection from "./RobotRealtimeStatusSection";
import RobotInfoViewSection from "./RobotInfoViewSection";
import RobotInfoEditSection from "./RobotInfoEditSection";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import { useAuth } from "@/app/context/AuthContext";

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

    const { refresh: refreshRobots } = useRobotStatusContext();
    const { user } = useAuth();
    const isAdminOrManager = user?.role === 1 || user?.role === 2;
    const [robotDetail, setRobotDetail] = useState<RobotRowData | null>(null);

    // B-1: 로딩 / 에러 상태
    const [isLoading, setIsLoading] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

    const loadRobotDetail = () => {
        if (selectedRobotId == null || !selectedRobot) return;
        setIsLoading(true);
        setFetchError(null);

        apiFetch(`/DB/robots/${selectedRobotId}`)
            .then((res) => {
                if (!res.ok) throw new Error("로봇 상세 조회 실패");
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
                    robotType: detail.type ?? "",
                });
                battery.reset(limitBattery);
            })
            .catch((err) => {
                console.error("robot detail fetch error:", err);
                setFetchError("로봇 정보를 불러오는 데 실패했습니다.");
            })
            .finally(() => setIsLoading(false));
    };

    useEffect(() => {
        if (!isOpen) return;
        if (selectedRobotId == null) return;
        if (!selectedRobot) return;
        setIsEditMode(initialEditMode);
        loadRobotDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    robotType: string;
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
    robotType: "",
    });

    const battery = useBatterySlider({ min: 15, max: 30, defaultValue: DEFAULT_RETURN_BATTERY });

    // Action modal states
    const [workScheduleModalOpen, setWorkScheduleModalOpen] = useState(false);
    const [placePathModalOpen, setPlacePathModalOpen] = useState(false);
    const [pathMoveModalOpen, setPathMoveModalOpen] = useState(false);
    const [batteryConfirmOpen, setBatteryConfirmOpen] = useState(false);
    const [stopChargeConfirmOpen, setStopChargeConfirmOpen] = useState(false);

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

    const src = robotDetail ?? selectedRobot;
    setDraft({
        robotName: src?.no ?? "",
        operator: src?.operator ?? "",
        serialNumber: src?.serialNumber ?? "",
        model: src?.model ?? "",
        group: src?.group ?? "",
        softwareVersion: src?.softwareVersion ?? "",
        site: src?.site ?? "",
        registrationDateTime: src?.registrationDateTime ?? "",
        returnBattery: typeof rb === "number" ? rb : DEFAULT_RETURN_BATTERY,
        robotType: src?.type ?? "",
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
            robot_type: draft.robotType || "기본 4족",
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
                    type: payload.robot_type as any,
                }
                : prev
            );

            // 2. draft도 동기화
            setDraft((p) => ({ ...p, returnBattery: rb }));

            // 3. 목록(Context) 갱신 — DB 변경을 테이블에 즉시 반영
            refreshRobots();

            // 4. 보기모드 전환
            setIsEditMode(false);

            // 5. 저장 완료 알림
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
        const [scheduleRes, pathRes] = await Promise.all([
          apiFetch(`/DB/schedule`),
          apiFetch(`/DB/getpath`),
        ]);
        if (!scheduleRes.ok) throw new Error('스케줄 조회 실패');
        if (!pathRes.ok) throw new Error('경로 조회 실패');

        const schedules = await scheduleRes.json();
        const paths = await pathRes.json();

        const wayPointsByName = new Map<string, string>(
          (Array.isArray(paths) ? paths : []).map((p: any) => [p.WayName, p.WayPoints ?? ''])
        );
        const resolvePath = (wayName?: string) =>
          (wayName && wayPointsByName.get(wayName)) || '';

        const robotSchedules = schedules.filter((s: any) => s.RobotName === robotName);

        const ongoing = robotSchedules.find((s: any) => s.TaskStatus === '진행');
        if (ongoing) {
          setWorkScheduleCase('ongoing');
          setCompletedPathText(resolvePath(ongoing.WayName));
          return;
        }

        const completed = robotSchedules
          .filter((s: any) => s.TaskStatus === '완료')
          .sort((a: any, b: any) => new Date(b.EndDate).getTime() - new Date(a.EndDate).getTime());
        if (completed.length > 0) {
          setWorkScheduleCase('recent');
          setCompletedPathText(resolvePath(completed[0].WayName));
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
      const r = robotDetail ?? selectedRobot;
      if (r?.isCharging) {
        apiAlert.show("이미 충전 중입니다.");
        return;
      }
      setBatteryConfirmOpen(true);
    };

    const handleChargeMoveConfirm = () => {
      if (!selectedRobotId) return;
      apiFetch(`/robot/return-to-charge`, {
        method: "POST",
      }).catch((err) => console.error("충전소 이동 실패", err));
      setBatteryConfirmOpen(false);
    };

    // 충전 해제: 확인 모달 표시
    const handleStopCharge = () => {
      setStopChargeConfirmOpen(true);
    };

    const handleStopChargeConfirm = () => {
      apiFetch(`/robot/stop-charge`, { method: "POST" })
        .catch((err) => console.error("충전 해제 실패", err));
      setStopChargeConfirmOpen(false);
    };

    return (
        <>
        <div className={styles.modalOverlay} onClick={isSubmitting ? undefined : onClose}>
            <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>

                {/* ── Header ── */}
                <div className={styles.detailHeader} style={isEditMode ? { paddingBottom: 0 } : undefined}>
                  <div className={styles.detailHeaderTop}>
                    <h2>{(robotDetail ?? selectedRobot)?.no ?? "로봇"} {isEditMode ? "수정" : "상세정보"}</h2>
                    <div className={styles.detailHeaderBtns}>
                      {!isEditMode && isAdminOrManager && (
                        <button className={styles.detailEditBtn} onClick={handleUdate} disabled={isSubmitting} aria-label="수정">
                          <Pencil size={16} />
                        </button>
                      )}
                      <button className={styles.detailCloseBtn} onClick={onClose} disabled={isSubmitting} aria-label="닫기">✕</button>
                    </div>
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
                            onClick={loadRobotDetail}
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
                  return (
                    <RobotRealtimeStatusSection
                      robot={r}
                      hasActiveSchedule={!!activeSchedule}
                    />
                  );
                })()}

                {/* ── 기본 정보 (2열 그리드) ── */}
                {isEditMode ? (
                  <RobotInfoEditSection
                    robot={robotDetail ?? selectedRobot}
                    draft={draft}
                    setDraft={setDraft}
                    fieldErrors={fieldErrors}
                    setFieldErrors={setFieldErrors}
                    battery={battery}
                    isSubmitting={isSubmitting}
                    onCancel={handleCancel}
                    onSave={handleSave}
                  />
                ) : (() => {
                  const r = robotDetail ?? selectedRobot;
                  if (!r) return null;
                  return (
                    <RobotInfoViewSection
                      robot={r}
                      returnBattery={draft.returnBattery}
                      onWorkScheduleOpen={openWorkScheduleModal}
                      onPlacePathOpen={() => setPlacePathModalOpen(true)}
                      onPathMoveOpen={openPathMoveModal}
                      onChargeMoveOpen={handleChargeMove}
                      onStopCharge={handleStopCharge}
                    />
                  );
                })()}

                {/* ── 현재 작업 섹션 ── */}
                {!isEditMode && (() => {
                  const r = robotDetail ?? selectedRobot;
                  if (!r) return null;
                  return (
                    <RobotActiveScheduleSection
                      activeSchedule={activeSchedule}
                      isOffline={r.power === "Off"}
                    />
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
            <ConfirmOnlyModal
                message="저장되었습니다."
                onConfirm={() => setSaveSuccessOpen(false)}
                hideCloseButton
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
              apiFetch(`/robot/return-to-work?mode=direct`, {
                method: "POST",
              }).catch((err) => console.error("작업 복귀 실패", err));
            }}
            onConfirmWhenNone={() => {
              window.location.href = "/scheduleManagement";
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
        {batteryConfirmOpen && (() => {
          const r = robotDetail ?? selectedRobot;
          const isWorking = !!(r?.isNavigating || activeSchedule);
          return (
            <BatteryPathModal
              isOpen={batteryConfirmOpen}
              message={isWorking
                ? "현재 진행 중인 작업을 중단하고, 충전소로 이동하시겠습니까?"
                : "충전소로 이동하시겠습니까?"}
              onConfirm={handleChargeMoveConfirm}
              onCancel={() => setBatteryConfirmOpen(false)}
            />
          );
        })()}
        {stopChargeConfirmOpen && (
          <BatteryPathModal
            isOpen={stopChargeConfirmOpen}
            message={"현재 로봇이 충전 중입니다.\n충전을 해제하시겠습니까?"}
            onConfirm={handleStopChargeConfirm}
            onCancel={() => setStopChargeConfirmOpen(false)}
          />
        )}
        </>
    );

}
