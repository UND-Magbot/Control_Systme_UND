"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Floor, RobotRowData } from "@/app/types";
import { apiFetch } from "@/app/lib/api";
import CustomSelect from "@/app/components/select/CustomSelect";
import ElevatorTab from "../elevator/ElevatorTab";
import DoorPanel from "./DoorPanel";
import FloorStack, { type FloorFacility } from "./FloorStack";
import styles from "./FacilityTab.module.css";

type Business = { id: number; BusinessName: string };

// 합본 조회(GET /facility) — 유형이 늘어도 층 스택은 이 한 곳만 읽는다.
type FacilityItem = {
  kind: "elevator" | "door";
  id: number;
  name: string;
  floorIds: number[];
  completeFloorIds: number[];
  complete: boolean;
};

type Kind = "elevator" | "door";

type Props = {
  floors: Floor[];
  businesses: Business[];
  robots: RobotRowData[];
};

/**
 * 맵관리 '시설 장치' 탭.
 *
 * 엘리베이터와 자동문은 둘 다 '건물에 붙은 설비'라 같은 화면에서 유형으로만 분기한다.
 * 좌측 층 스택은 유형을 바꿔도 그대로 유지된다 — "1F에 무엇이 있나"를 한 곳에서 읽게 하려고
 * 유형별 탭으로 쪼개지 않았다(PRD-ELEV-DEVICE-CONSOLE §9 결정 기록).
 */
export default function FacilityTab({ floors, businesses, robots }: Props) {
  const [businessId, setBusinessId] = useState<number | "">(businesses[0]?.id ?? "");
  const [kind, setKind] = useState<Kind>("elevator");
  const [facilities, setFacilities] = useState<FacilityItem[]>([]);
  // 패널이 편집 중인 초안 — 저장 전에도 층 스택 뱃지가 따라 움직이도록 덮어쓴다.
  // id 를 함께 들고 있어야 '정차 해제'·'층 변경'처럼 빠지는 변화까지 반영된다.
  const [evDraft, setEvDraft] = useState<{ id: number | null; floors: Record<number, { complete: boolean }> }>(
    { id: null, floors: {} }
  );
  const [doorDraft, setDoorDraft] = useState<{ id: number | null; floorId: number | null; complete: boolean }>(
    { id: null, floorId: null, complete: false }
  );
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);

  const handleEvDraft = useCallback(
    (id: number | null, floors: Record<number, { complete: boolean }>) => setEvDraft({ id, floors }),
    []
  );
  const handleDoorDraft = useCallback(
    (id: number | null, state: { floorId: number | null; complete: boolean } | null) =>
      setDoorDraft({ id, floorId: state?.floorId ?? null, complete: !!state?.complete }),
    []
  );

  const robotFloorIds = useMemo(
    () => new Set(robots.filter((r) => r.currentFloorId != null).map((r) => r.currentFloorId as number)),
    [robots]
  );

  const fetchFacilities = useCallback(async (biz: number) => {
    try {
      const res = await apiFetch(`/facility?business_id=${biz}`);
      setFacilities(res.ok ? await res.json() : []);
    } catch {
      setFacilities([]);
    }
  }, []);

  useEffect(() => {
    if (businessId !== "") fetchFacilities(businessId as number);
  }, [businessId, fetchFacilities]);

  const refreshFacilities = useCallback(() => {
    if (businessId !== "") fetchFacilities(businessId as number);
  }, [businessId, fetchFacilities]);

  // 저장된 합본 + 편집 중 초안을 층별로 합친다(초안이 우선).
  const floorFacilities = useMemo(() => {
    const map: Record<number, FloorFacility> = {};
    const touch = (fid: number) => (map[fid] ??= {});

    for (const item of facilities) {
      // 지금 편집 중인 설비는 저장본 대신 초안으로 그린다(아래에서 덮어쓴다).
      if (kind === "elevator" && item.kind === "elevator" && item.id === evDraft.id) continue;
      if (kind === "door" && item.kind === "door" && item.id === doorDraft.id) continue;
      const completeSet = new Set(item.completeFloorIds);
      for (const fid of item.floorIds) {
        const slot = touch(fid);
        if (item.kind === "elevator") {
          slot.evStop = true;
          slot.evComplete = (slot.evComplete ?? false) || completeSet.has(fid);
        } else {
          slot.door = true;
          slot.doorComplete = (slot.doorComplete ?? false) || completeSet.has(fid);
        }
      }
    }

    if (kind === "elevator") {
      for (const [fid, s] of Object.entries(evDraft.floors)) {
        const slot = touch(Number(fid));
        slot.evStop = true;
        slot.evComplete = (slot.evComplete ?? false) || s.complete;
      }
    }
    if (kind === "door" && doorDraft.floorId != null) {
      const slot = touch(doorDraft.floorId);
      slot.door = true;
      slot.doorComplete = (slot.doorComplete ?? false) || doorDraft.complete;
    }
    return map;
  }, [facilities, evDraft, doorDraft, kind]);

  const focusFloorId = kind === "door" ? doorDraft.floorId : null;

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <h2>시설 장치</h2>
        <div className={styles.toolbar}>
          {businesses.length > 1 && (
            <CustomSelect
              options={businesses.map((b) => ({ id: b.id, label: b.BusinessName }))}
              value={(() => { const b = businesses.find((x) => x.id === businessId); return b ? { id: b.id, label: b.BusinessName } : null; })()}
              onChange={(o) => setBusinessId(Number(o.id))}
              placeholder="사업장 선택"
              width={170}
              overlay
            />
          )}
          <div className={styles.kindSeg}>
            <button
              type="button"
              className={`${styles.kindBtn} ${kind === "elevator" ? styles.kindBtnOn : ""}`}
              onClick={() => setKind("elevator")}
            >
              엘리베이터
            </button>
            <button
              type="button"
              className={`${styles.kindBtn} ${kind === "door" ? styles.kindBtnOn : ""}`}
              onClick={() => setKind("door")}
            >
              자동문
            </button>
          </div>
          <span className={styles.toolSep} />
          {/* 유형별 툴바(장치 선택·추가·삭제·저장)는 각 패널이 여기에 그린다. */}
          <div ref={setToolbarSlot} className={styles.toolbar} />
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.stackCol}>
          <div className={styles.colHead}>
            건물 층 구조 <span className={styles.shared}>공유</span>
          </div>
          <FloorStack
            floors={floors}
            facilities={floorFacilities}
            robotFloorIds={robotFloorIds}
            focusFloorId={focusFloorId}
          />
          <div className={styles.legend}>
            <span className={styles.legendRow}>
              <span className={`${styles.badge} ${styles.badgeOk}`}>정차</span>
              <span>자율 전환 가능</span>
            </span>
            <span className={styles.legendRow}>
              <span className={`${styles.badge} ${styles.badgeDoor}`}>자동문</span>
              <span>등록된 문</span>
            </span>
            <span className={styles.legendRow}>
              <span className={`${styles.badge} ${styles.badgeWarn}`}>미완료</span>
              <span>맵·POI 미지정</span>
            </span>
          </div>
          <div className={styles.hint}>
            유형을 바꿔도 <b>층 스택은 그대로</b>입니다. 등록이 끝난 설비만 자율 주행 대상이 됩니다.
          </div>
        </div>

        <div className={styles.detailCol}>
          {kind === "elevator" ? (
            <ElevatorTab
              floors={floors}
              businessId={businessId}
              toolbarSlot={toolbarSlot}
              onFacilityChanged={refreshFacilities}
              onDraftFloors={handleEvDraft}
            />
          ) : (
            <DoorPanel
              businessId={businessId}
              floors={floors}
              toolbarSlot={toolbarSlot}
              onFacilityChanged={refreshFacilities}
              onDraftFloor={handleDoorDraft}
            />
          )}
        </div>
      </div>
    </div>
  );
}
