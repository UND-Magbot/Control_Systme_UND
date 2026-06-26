"use client";

import { useEffect, useRef, useState } from "react";
import { useAlertContext } from "@/app/context/AlertContext";
import { markAlertRead } from "@/app/lib/alertData";
import InitPoseConfirmModal from "@/app/components/modal/InitPoseConfirmModal";

/**
 * 자동 위치 초기화 실패(action=robot_initpose_manual_needed) 알람을
 * 글로벌 폴링 사이클에서 감지하여 '위치 초기화 필요' 확인창을 띄운다.
 *
 * - ThermalAlertWatcher 패턴을 따른다(이미 본 알람 ID를 sessionStorage 로 중복 방지).
 * - 단, 미초기화는 '고칠 때까지 지속되는 상태'이므로 자동 닫힘을 두지 않는다.
 *   · '위치 재조정' 성공 → 닫고 읽음 처리
 *   · '나중에' → 모달만 닫고 알림은 알림센터에 유지(다시 열람 가능)
 */

const SEEN_KEY = "initpose_alert_seen_ids_v1";
// 자동 표시는 최근 발생 알람만(오래된 백로그까지 뒤늦게 띄워 도배하는 것 방지). 그 외는 알림센터/툴바 버튼으로.
const RECENT_SEC = 600;

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

export default function InitPoseAlertWatcher() {
  const { unreadAlerts } = useAlertContext();
  const seenRef = useRef<Set<number>>(loadSeen());
  const [modal, setModal] = useState<{
    id: number;
    robotName?: string;
    detectedAt?: string;
  } | null>(null);

  useEffect(() => {
    // 미읽음 + manual_needed + '나중에'로 닫지 않은 + 최근(RECENT_SEC) 알람 중 최신 1개를 표시.
    // 표시했다고 seen 처리하지 않는다 → 사용자가 잠깐 다른 화면이어서 놓쳐도, 미해결인 동안 다시 뜬다.
    // (해결하면 read 처리되어 unread 에서 빠지고, '나중에'를 누르면 그 알람만 seen 으로 억제.)
    const now = Date.now();
    const fresh = unreadAlerts
      .filter(
        (a) =>
          a.log?.Action === "robot_initpose_manual_needed" &&
          !seenRef.current.has(a.id) &&
          now - new Date(a.log?.CreatedAt ?? a.date).getTime() < RECENT_SEC * 1000
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    if (!fresh) return;

    // 이미 같은 알람을 띄우고 있으면 재설정하지 않는다(폴링마다 깜빡임 방지).
    setModal((prev) =>
      prev && prev.id === fresh.id
        ? prev
        : {
            id: fresh.id,
            robotName: fresh.robotName ?? fresh.log?.RobotName ?? undefined,
            detectedAt: fresh.log?.CreatedAt ?? fresh.date,
          }
    );
  }, [unreadAlerts]);

  if (!modal) return null;

  const closeAndMarkRead = () => {
    const id = modal.id;
    setModal(null);
    markAlertRead(id).catch(() => {
      /* 실패해도 모달은 닫음 — read 처리로 unread 에서 빠져 재표시 안 됨 */
    });
  };

  // '나중에': 이 알람만 seen 으로 억제하고 모달을 닫는다(알림센터에는 unread 로 남음).
  const closeOnly = () => {
    seenRef.current.add(modal.id);
    saveSeen(seenRef.current);
    setModal(null);
  };

  return (
    <InitPoseConfirmModal
      open={true}
      robotName={modal.robotName}
      detectedAt={modal.detectedAt}
      onResolved={closeAndMarkRead}
      onClose={closeOnly}
      zIndex={10000}
    />
  );
}
