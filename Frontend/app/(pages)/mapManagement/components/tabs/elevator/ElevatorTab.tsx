"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Floor } from "@/app/types";
import { apiFetch } from "@/app/lib/api";
import { useModalAlert } from "@/app/hooks/useModalAlert";
import AlertModal from "@/app/components/modal/AlertModal";
import CustomSelect from "@/app/components/select/CustomSelect";
import ElevatorNameModal from "./ElevatorNameModal";
import styles from "./ElevatorTab.module.css";

type MapItem = { id: number; FloorId: number; MapName: string };
type PlaceItem = { id: number; LacationName: string; Category?: string };

type StopDraft = {
  mapId: number | "";
  lobby: number | "";
  panel: number | "";
  inside: number | "";
};

type ElevatorDto = {
  id: number;
  businessId: number;
  name: string;
  serviceFloorIds: number[];
  stops: {
    floorId: number;
    mapId: number | null;
    lobbyLocationId: number | null;
    panelLocationId: number | null;
    insideLocationId: number | null;
    complete: boolean;
  }[];
};

// 시설 장치 탭(FacilityTab)의 '엘리베이터' 상세 패널.
// 사업장 선택·층 스택·탭 컨테이너는 껍데기가 갖고, 여기는 정차 매트릭스만 담당한다.
type Props = {
  floors: Floor[];
  businessId: number | "";
  toolbarSlot: HTMLElement | null;
  /** 생성/저장/삭제 후 합본(층 스택) 갱신 요청 */
  onFacilityChanged: () => void;
  /** 편집 중 초안을 층 스택에 즉시 반영(저장본 대신 이 초안이 우선한다) */
  onDraftFloors: (elevatorId: number | null, state: Record<number, { complete: boolean }>) => void;
};

const EMPTY_STOP: StopDraft = { mapId: "", lobby: "", panel: "", inside: "" };

function isComplete(s: StopDraft): boolean {
  return !!(s.mapId && s.lobby && s.panel && s.inside);
}

export default function ElevatorTab({ floors, businessId, toolbarSlot, onFacilityChanged, onDraftFloors }: Props) {
  const [elevators, setElevators] = useState<ElevatorDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // 층별 정차 초안: floorId → StopDraft (있으면 '정차', 없으면 미정차)
  const [draft, setDraft] = useState<Record<number, StopDraft>>({});
  const [floorMaps, setFloorMaps] = useState<Record<number, MapItem[]>>({});
  const [mapPlaces, setMapPlaces] = useState<Record<number, PlaceItem[]>>({});
  const [saving, setSaving] = useState(false);
  const { modal, modalAlert, modalConfirm, closeModal, handleConfirm } = useModalAlert();
  const [nameModal, setNameModal] = useState<{ open: boolean; mode: "create" | "rename"; initial: string }>(
    { open: false, mode: "create", initial: "" }
  );

  // 사업장 엘리베이터 로드
  const fetchElevators = useCallback(async (biz: number) => {
    try {
      const res = await apiFetch(`/elevator?business_id=${biz}`);
      const data: ElevatorDto[] = res.ok ? await res.json() : [];
      setElevators(data);
      setSelectedId((prev) => (data.some((e) => e.id === prev) ? prev : data[0]?.id ?? null));
    } catch {
      setElevators([]);
      setSelectedId(null);
    }
  }, []);

  useEffect(() => {
    if (businessId !== "") fetchElevators(businessId as number);
  }, [businessId, fetchElevators]);

  // 선택 엘리베이터 → 초안 구성
  const selected = elevators.find((e) => e.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected) { setDraft({}); return; }
    const d: Record<number, StopDraft> = {};
    for (const s of selected.stops) {
      d[s.floorId] = {
        mapId: s.mapId ?? "",
        lobby: s.lobbyLocationId ?? "",
        panel: s.panelLocationId ?? "",
        inside: s.insideLocationId ?? "",
      };
    }
    setDraft(d);
  }, [selectedId, elevators]);

  // 초안 → 공유 층 스택(저장 전에도 뱃지가 따라 움직인다).
  // 정차 해제처럼 '빠지는' 변화도 반영되도록 선택 엘리베이터 id 를 함께 넘긴다.
  useEffect(() => {
    const state: Record<number, { complete: boolean }> = {};
    for (const [fid, s] of Object.entries(draft)) state[Number(fid)] = { complete: isComplete(s) };
    onDraftFloors(selectedId, state);
  }, [draft, selectedId, onDraftFloors]);

  // 층별 맵 lazy 로드
  const ensureMaps = useCallback(async (floorId: number) => {
    if (floorMaps[floorId]) return;
    try {
      const res = await apiFetch(`/map/maps?floor_id=${floorId}`);
      const data: MapItem[] = res.ok ? await res.json() : [];
      setFloorMaps((p) => ({ ...p, [floorId]: data }));
    } catch {
      setFloorMaps((p) => ({ ...p, [floorId]: [] }));
    }
  }, [floorMaps]);

  // 맵별 장소(POI) lazy 로드
  const ensurePlaces = useCallback(async (mapId: number) => {
    if (mapPlaces[mapId]) return;
    try {
      const res = await apiFetch(`/DB/places?map_id=${mapId}`);
      const data: PlaceItem[] = res.ok ? await res.json() : [];
      setMapPlaces((p) => ({ ...p, [mapId]: data }));
    } catch {
      setMapPlaces((p) => ({ ...p, [mapId]: [] }));
    }
  }, [mapPlaces]);

  // 정차 층의 맵/장소 프리로드
  useEffect(() => {
    for (const fid of Object.keys(draft)) {
      ensureMaps(Number(fid));
      const m = draft[Number(fid)].mapId;
      if (m) ensurePlaces(m as number);
    }
  }, [draft, ensureMaps, ensurePlaces]);

  const toggleFloor = (floorId: number, on: boolean) => {
    setDraft((p) => {
      const next = { ...p };
      if (on) { next[floorId] = { ...EMPTY_STOP }; ensureMaps(floorId); }
      else delete next[floorId];
      return next;
    });
  };

  const setField = (floorId: number, field: keyof StopDraft, value: number | "") => {
    setDraft((p) => {
      const cur = p[floorId] ?? { ...EMPTY_STOP };
      const next = { ...cur, [field]: value };
      // 맵이 바뀌면 POI 선택 초기화
      if (field === "mapId") { next.lobby = ""; next.panel = ""; next.inside = ""; if (value) ensurePlaces(value as number); }
      return { ...p, [floorId]: next };
    });
  };

  const openCreate = () => setNameModal({ open: true, mode: "create", initial: "" });
  const openRename = () => { if (selected) setNameModal({ open: true, mode: "rename", initial: selected.name }); };

  const submitName = async (name: string) => {
    const mode = nameModal.mode;
    setNameModal((p) => ({ ...p, open: false }));
    try {
      if (mode === "create") {
        if (businessId === "") return;
        const res = await apiFetch(`/elevator`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ business_id: businessId, name }),
        });
        if (!res.ok) throw new Error();
        const created: ElevatorDto = await res.json();
        await fetchElevators(businessId as number);
        setSelectedId(created.id);
        onFacilityChanged();
      } else {
        if (selectedId == null) return;
        const res = await apiFetch(`/elevator/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error();
        await fetchElevators(businessId as number);
        onFacilityChanged();
      }
    } catch {
      modalAlert(mode === "create" ? "엘리베이터 생성에 실패했습니다." : "이름 변경에 실패했습니다.");
    }
  };

  const deleteElevator = () => {
    if (selectedId == null || !selected) return;
    modalConfirm(`'${selected.name}' 엘리베이터를 삭제할까요?\n등록된 정차·POI 매핑도 함께 삭제됩니다.`, async () => {
      const res = await apiFetch(`/elevator/${selectedId}`, { method: "DELETE" });
      if (res.ok) { setSelectedId(null); await fetchElevators(businessId as number); onFacilityChanged(); }
      else modalAlert("삭제에 실패했습니다.");
    });
  };

  const save = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const stops = Object.entries(draft).map(([fid, s]) => ({
        floor_id: Number(fid),
        map_id: s.mapId || null,
        lobby_location_id: s.lobby || null,
        panel_location_id: s.panel || null,
        inside_location_id: s.inside || null,
      }));
      const res = await apiFetch(`/elevator/${selectedId}/stops`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stops }),
      });
      if (!res.ok) throw new Error();
      await fetchElevators(businessId as number);
      onFacilityChanged();
      modalAlert("저장되었습니다.");
    } catch {
      modalAlert("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const floorsDesc = [...floors].sort((a, b) => b.id - a.id);

  const toolbar = (
    <>
      <CustomSelect
        options={elevators.map((e) => ({ id: e.id, label: e.name }))}
        value={(() => { const e = elevators.find((x) => x.id === selectedId); return e ? { id: e.id, label: e.name } : null; })()}
        onChange={(o) => setSelectedId(Number(o.id))}
        placeholder={elevators.length ? "엘리베이터 선택" : "엘리베이터 없음"}
        width={190}
        overlay
        disabled={elevators.length === 0}
      />
      <button className={styles.btn} onClick={openCreate} disabled={businessId === ""}>+ 엘리베이터</button>
      {selectedId != null && <button className={styles.btn} onClick={openRename}>이름 변경</button>}
      {selectedId != null && <button className={`${styles.btn} ${styles.btnDanger}`} onClick={deleteElevator}>삭제</button>}
      <button className={`${styles.btn} ${styles.btnPri}`} onClick={save} disabled={selectedId == null || saving}>
        {saving ? "저장 중..." : "저장"}
      </button>
    </>
  );

  return (
    <>
      {toolbarSlot && createPortal(toolbar, toolbarSlot)}

      {selectedId == null ? (
        <div className={styles.empty}>엘리베이터를 선택하거나 새로 추가하세요.</div>
      ) : (
        <table className={styles.tbl}>
          <thead>
            <tr>
              <th>정차</th><th>층</th><th>맵</th><th>로비 진입 POI</th><th>패널 정위치 POI</th><th>내부 정지 POI</th>
            </tr>
          </thead>
          <tbody>
            {floorsDesc.map((f) => {
              const s = draft[f.id];
              const serviced = !!s;
              const maps = floorMaps[f.id] ?? [];
              const places = s && s.mapId ? (mapPlaces[s.mapId as number] ?? []) : [];
              return (
                <tr key={f.id} className={serviced ? "" : styles.rowOff}>
                  <td>
                    <input
                      type="checkbox"
                      checked={serviced}
                      onChange={(e) => toggleFloor(f.id, e.target.checked)}
                    />
                  </td>
                  <td className={styles.tdFloor}>{f.label}</td>
                  <td>
                    <CustomSelect
                      options={maps.map((m) => ({ id: m.id, label: m.MapName }))}
                      value={(() => { const m = maps.find((x) => x.id === s?.mapId); return m ? { id: m.id, label: m.MapName } : null; })()}
                      onChange={(o) => setField(f.id, "mapId", Number(o.id))}
                      placeholder={maps.length ? "맵 선택" : "맵 없음"}
                      disabled={!serviced || maps.length === 0}
                      overlay
                      compact
                      width="100%"
                    />
                  </td>
                  {(["lobby", "panel", "inside"] as const).map((field) => (
                    <td key={field}>
                      <CustomSelect
                        options={[{ id: "", label: "미지정" }, ...places.map((p) => ({ id: p.id, label: p.LacationName || `#${p.id}` }))]}
                        value={(() => {
                          const v = s?.[field];
                          if (!v) return { id: "", label: "미지정" };
                          const p = places.find((x) => x.id === v);
                          return p ? { id: p.id, label: p.LacationName || `#${p.id}` } : { id: "", label: "미지정" };
                        })()}
                        onChange={(o) => setField(f.id, field, o.id === "" ? "" : Number(o.id))}
                        placeholder={places.length ? "미지정" : "맵 먼저"}
                        disabled={!serviced || !s?.mapId}
                        error={!!(serviced && s && !s[field])}
                        overlay
                        compact
                        width="100%"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ElevatorNameModal
        open={nameModal.open}
        title={nameModal.mode === "create" ? "엘리베이터 추가" : "엘리베이터 이름 변경"}
        initial={nameModal.initial}
        onSubmit={submitName}
        onCancel={() => setNameModal((p) => ({ ...p, open: false }))}
      />

      <AlertModal
        open={modal.open}
        message={modal.message}
        mode={modal.mode}
        onConfirm={handleConfirm}
        onClose={closeModal}
      />
    </>
  );
}
