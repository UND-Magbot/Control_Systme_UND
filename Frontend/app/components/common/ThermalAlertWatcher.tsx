"use client";

import { useEffect, useRef, useState } from "react";
import { useAlertContext } from "@/app/context/AlertContext";
import { markAlertRead } from "@/app/lib/alertData";
import ThermalAlertModal from "@/app/components/modal/ThermalAlertModal";

/**
 * 열화상에서 발화된 '고온 감지'(action=thermal_temp_high) 알람을
 * 글로벌 폴링 사이클에서 감지하여 자동으로 팝업 모달을 띄운다.
 *
 * - 이미 본 알람 ID는 sessionStorage에 기록 → 새로고침 후에도 같은 알람 중복 방지
 * - 모달 확인 시 해당 알람을 읽음 처리 → AlertContext 미읽음 목록에서 제거
 * - 온도/감지 시각은 log.Detail("온도 50.1°C 측정 · 감지 시각 ...")에서 정규식 추출
 */

const SEEN_KEY = "thermal_alert_seen_ids_v1";
// 모달이 뜬 후 사용자가 확인 버튼을 누르지 않아도 N ms 후 자동으로 닫고 읽음 처리.
const AUTO_CLOSE_MS = 5000;

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

/** "온도 50.1°C 측정 · 감지 시각 ..." 같은 detail 문자열에서 숫자(°C) 추출. */
function parseTemperature(detail?: string | null): number | null {
  if (!detail) return null;
  const m = detail.match(/(-?\d+(?:\.\d+)?)\s*°?\s*C/i);
  return m ? parseFloat(m[1]) : null;
}

/** detail 문자열에서 "감지 시각 <ISO>" 추출. */
function parseDetectedAt(detail?: string | null): string | undefined {
  if (!detail) return undefined;
  const m = detail.match(/감지 시각\s*([0-9T:\-\s]+)/);
  return m ? m[1].trim() : undefined;
}

export default function ThermalAlertWatcher() {
  const { unreadAlerts } = useAlertContext();
  const seenRef = useRef<Set<number>>(loadSeen());
  const [modal, setModal] = useState<{
    id: number;
    temperature: number | null;
    robotName?: string;
    detectedAt?: string;
  } | null>(null);

  useEffect(() => {
    const fresh = unreadAlerts
      .filter((a) => a.log?.Action === "thermal_temp_high" && !seenRef.current.has(a.id))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    if (!fresh) return;

    seenRef.current.add(fresh.id);
    saveSeen(seenRef.current);

    const detailStr = fresh.log?.Detail ?? fresh.content ?? "";
    setModal({
      id: fresh.id,
      temperature: parseTemperature(detailStr),
      robotName: fresh.robotName ?? fresh.log?.RobotName ?? undefined,
      detectedAt: parseDetectedAt(detailStr) ?? fresh.log?.CreatedAt ?? fresh.date,
    });
  }, [unreadAlerts]);

  // 모달이 열려 있는 동안 AUTO_CLOSE_MS 후 자동으로 닫고 읽음 처리.
  // 사용자가 수동으로 닫으면 modal이 null이 되어 cleanup이 타이머를 해제하고,
  // 그 사이 새 알람이 와서 modal이 교체되면 새 5초 타이머가 다시 시작된다.
  useEffect(() => {
    if (!modal) return;
    const id = modal.id;
    const timer = setTimeout(() => {
      setModal(null);
      markAlertRead(id).catch(() => {
        /* 실패해도 모달은 닫음 — seen 기록이 있어 중복 표시 안 됨 */
      });
    }, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [modal]);

  if (!modal) return null;

  const closeAndMarkRead = () => {
    const id = modal.id;
    setModal(null);
    markAlertRead(id).catch(() => {
      /* 실패해도 모달은 닫음 — seen 기록이 있어 중복 표시 안 됨 */
    });
  };

  return (
    <ThermalAlertModal
      open={true}
      temperature={modal.temperature}
      robotName={modal.robotName}
      detectedAt={modal.detectedAt}
      onConfirm={closeAndMarkRead}
      onClose={closeAndMarkRead}
      // 카메라 확대 모달(z-index 200) 등 다른 모달이 떠 있어도 그 위에 표시
      zIndex={9999}
    />
  );
}
