"use client";

import { useEffect, useRef, useState } from "react";
import { useAlertContext } from "@/app/context/AlertContext";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import { markAlertRead } from "@/app/lib/alertData";
import { apiFetch } from "@/app/lib/api";
import InitPoseConfirmModal from "@/app/components/modal/InitPoseConfirmModal";
import RelocalizeModal from "@/app/components/modal/RelocalizeModal";
import {
  useFloorMapConfig,
  type FloorMapRow,
} from "@/app/(pages)/mapManagement/hooks/useFloorMapConfig";

/**
 * 자동 위치 초기화 실패(action=robot_initpose_manual_needed) 알람을
 * 글로벌 폴링 사이클에서 감지하여 '로봇 위치 확인 필요' 확인창을 띄운다.
 *
 * - '수동 위치 재조정' → 로봇 현재 층 맵으로 RelocalizeModal(스캔 정합 도구)을 연다.
 *   (맵 관리에서 로봇 연결 후 '위치 재조정'을 누른 것과 동일한 모달·기능)
 * - '나중에' → 모달만 닫고 알림은 알림센터에 유지.
 * - 미초기화가 해제(자동 복구/확정)되면 모달을 자동으로 닫는다.
 */

// v2: '수동 위치 재조정' 열람만으로 알림을 영구 억제하던 버그를 고치며 키를 올려 기존 억제분을 리셋.
const SEEN_KEY = "initpose_alert_seen_ids_v2";
// 알림이 읽음 처리/소실됐지만 로봇이 여전히 미확정일 때, 알림 없이 모달을 띄우기 위한 폴백 id.
const FALLBACK_ID = -1;

function loadSeen(): Set<number> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((v) => typeof v === "number"));
  } catch {
    /* ignore */
  }
  return new Set();
}

function saveSeen(seen: Set<number>) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen)));
  } catch {
    /* ignore */
  }
}

type AdjustTarget = {
  id: number;
  name?: string;
  mapId: number | null;
  floorId: number | null;
};

export default function InitPoseAlertWatcher() {
  const { unreadAlerts } = useAlertContext();
  const { robots, refresh: refreshRobots } = useRobotStatusContext();
  const seenRef = useRef<Set<number>>(loadSeen());
  const [modal, setModal] = useState<{
    id: number;
    robotName?: string;
    detectedAt?: string;
  } | null>(null);

  // 수동 위치 재조정(스캔 정합) 도구 상태
  const [showRelocalize, setShowRelocalize] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [adjustAlertId, setAdjustAlertId] = useState<number | null>(null);
  const [mapRows, setMapRows] = useState<FloorMapRow[]>([]);

  // 재조정 대상 로봇 현재 맵의 CanvasMap 설정
  const relocalizeMapConfig = useFloorMapConfig(adjustTarget?.mapId ?? null, mapRows);

  // 실제로 위치 미확정인 로봇이 있는지. 자동 복구·확정으로 풀리면 알림 모달을 자동으로 닫는다.
  const anyPending = robots.some((r) => r.initposePending);

  useEffect(() => {
    // 미확정 로봇이 없으면(복구 완료) 열려 있던 알림 모달을 닫는다.
    if (!anyPending) {
      setModal(null);
      return;
    }
    // 재조정 도구가 열려 있는 동안엔 알림 모달을 다시 띄우지 않는다.
    if (showRelocalize) return;

    // anyPending==true 인 시점에만 여기 도달하므로(위 가드), 미확정이 살아있는 '현재 조건'이다.
    // 따라서 오래된 백로그 방지용 나이 제한은 적용하지 않는다 — 미확정인 동안 계속 안내.
    const manualAlerts = unreadAlerts.filter(
      (a) => a.log?.Action === "robot_initpose_manual_needed"
    );
    const fresh = manualAlerts
      .filter((a) => !seenRef.current.has(a.id))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    // 미확정 알림이 있는데 전부 '나중에'로 억제됐으면 표시하지 않는다.
    if (!fresh && manualAlerts.length > 0) return;
    // 폴백(알림이 읽음 처리/소실됐지만 미확정인 경우)도 '나중에'로 억제됐으면 표시 안 함.
    if (!fresh && seenRef.current.has(FALLBACK_ID)) return;

    // fresh 알림이 있으면 그 id/메타를, 없으면 미확정 상태만으로 폴백 표시(id=FALLBACK_ID).
    const pendingRobot = robots.find((r) => r.initposePending);
    const id = fresh?.id ?? FALLBACK_ID;
    const robotName =
      fresh?.robotName ?? fresh?.log?.RobotName ?? pendingRobot?.no ?? undefined;
    const detectedAt = fresh?.log?.CreatedAt ?? fresh?.date ?? undefined;

    setModal((prev) => (prev && prev.id === id ? prev : { id, robotName, detectedAt }));
  }, [unreadAlerts, anyPending, showRelocalize, robots]);

  // 재조정 도구가 열리면 대상 로봇의 현재 층 맵 목록을 불러온다(CanvasMap 설정 재료).
  useEffect(() => {
    if (!showRelocalize || adjustTarget?.floorId == null) {
      return;
    }
    let cancelled = false;
    apiFetch(`/map/maps?floor_id=${adjustTarget.floorId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: FloorMapRow[]) => {
        if (!cancelled) setMapRows(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setMapRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showRelocalize, adjustTarget?.floorId]);

  // '나중에': 이 알람만 seen 으로 억제하고 모달을 닫는다(알림센터에는 unread 로 남음).
  const closeOnly = () => {
    if (modal) {
      seenRef.current.add(modal.id);
      saveSeen(seenRef.current);
    }
    setModal(null);
  };

  // '수동 위치 재조정': 알림 모달을 닫고 재조정 도구를 연다.
  // (도구가 열려 있는 동안엔 위 effect 의 showRelocalize 가드가 알림 재표시를 막고,
  //  도구를 완료 없이 닫으면 미확정이 유지되므로 알림이 다시 떠서 재조정을 유도한다.
  //  → 여기서 seen 으로 영구 억제하지 않는다.)
  const handleManualAdjust = () => {
    if (!modal) return;
    const rob = robots.find((r) => r.initposePending);
    setAdjustAlertId(modal.id);
    setAdjustTarget(
      rob
        ? {
            id: rob.id,
            name: rob.no,
            mapId: rob.currentMapId ?? null,
            floorId: rob.currentFloorId ?? null,
          }
        : null
    );
    setModal(null);
    setShowRelocalize(true);
  };

  const handleRelocalizeConfirmed = () => {
    // 실제 알림 id(>0)일 때만 읽음 처리(폴백 id=-1 은 실제 알림이 아님).
    if (adjustAlertId != null && adjustAlertId > 0) {
      markAlertRead(adjustAlertId).catch(() => {
        /* 실패해도 무시 — 미확정 해제로 다음 폴링에 정리됨 */
      });
    }
    // 미확정 해제를 화면에 즉시 반영(5s 폴링 대기 없이).
    refreshRobots().catch(() => {});
  };

  const closeRelocalize = () => {
    setShowRelocalize(false);
    setAdjustTarget(null);
    setMapRows([]);
  };

  return (
    <>
      {modal && (
        <InitPoseConfirmModal
          open
          robotName={modal.robotName}
          detectedAt={modal.detectedAt}
          onManualAdjust={handleManualAdjust}
          onClose={closeOnly}
          zIndex={10000}
        />
      )}
      {showRelocalize && (
        <RelocalizeModal
          open
          mapConfig={relocalizeMapConfig}
          robotId={adjustTarget?.id}
          robotName={adjustTarget?.name}
          onClose={closeRelocalize}
          onConfirmed={handleRelocalizeConfirmed}
        />
      )}
    </>
  );
}
