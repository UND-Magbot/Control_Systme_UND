"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Floor } from "@/app/types";
import { apiFetch } from "@/app/lib/api";
import { useModalAlert } from "@/app/hooks/useModalAlert";
import AlertModal from "@/app/components/modal/AlertModal";
import CustomSelect from "@/app/components/select/CustomSelect";
import ElevatorNameModal from "../elevator/ElevatorNameModal";
import styles from "./FacilityTab.module.css";

type MapItem = { id: number; FloorId: number; MapName: string };
type PlaceItem = { id: number; LacationName: string; Category?: string };

export type DoorDto = {
  id: number;
  businessId: number;
  name: string;
  floorId: number | null;
  mapId: number | null;
  nearLocationId: number | null;
  farLocationId: number | null;
  controlType: string | null;
  controlConfig: Record<string, unknown>;
  detectType: string;
  openTimeoutSec: number;
  passTimeoutSec: number;
  complete: boolean;
};

type Draft = {
  floorId: number | "";
  mapId: number | "";
  near: number | "";
  far: number | "";
  controlType: string | "";
  detectType: string;
  openTimeoutSec: number;
  passTimeoutSec: number;
  controlConfig: Record<string, string>;
};

type PoiOption = { id: number | ""; label: string };

type Props = {
  businessId: number | "";
  floors: Floor[];
  toolbarSlot: HTMLElement | null;
  /** 생성/저장/삭제 후 층 스택(합본) 갱신 요청 */
  onFacilityChanged: () => void;
  /** 편집 중 초안을 층 스택에 즉시 반영(저장본 대신 이 초안이 우선한다) */
  onDraftFloor: (doorId: number | null, state: { floorId: number | null; complete: boolean } | null) => void;
};

// id 는 API 계약(ControlType), 라벨은 조작자 언어만 노출한다.
const CONTROL_TYPES: { id: string; label: string }[] = [
  { id: "manual", label: "상시 개방" },
  { id: "auto_sensor", label: "자동 센서" },
  { id: "gpio", label: "접점/릴레이" },
  { id: "ble", label: "무선 리모컨" },
  { id: "rm_vision", label: "로봇 팔로 버튼 누름" },
];

// 로봇이 '문이 열렸다'를 어떻게 아는가 — 결과(진입 조건)까지 라벨에 적는다.
const DETECT_TYPES: { id: string; label: string }[] = [
  { id: "none", label: "확인 안 함 — 열렸다고 보고 진입" },
  { id: "vision", label: "카메라로 확인 — 열린 것을 보고 진입" },
];

// 개폐 방식별 추가 설정 — 방식을 바꾸면 필요한 필드만 남는다.
const CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  manual: [{ key: "open_hours", label: "운영 시간대", placeholder: "예: 09:00-18:00 (선택)" }],
  auto_sensor: [],
  gpio: [
    { key: "host", label: "호스트", placeholder: "192.168.0.50" },
    { key: "port", label: "포트", placeholder: "8080" },
    { key: "channel", label: "채널", placeholder: "1" },
    { key: "pulse_ms", label: "펄스(ms)", placeholder: "500" },
  ],
  ble: [
    { key: "mac", label: "장치 MAC", placeholder: "AA:BB:CC:DD:EE:FF" },
    { key: "service_uuid", label: "서비스 UUID", placeholder: "0000ffe0-0000-1000-8000-00805f9b34fb" },
  ],
  rm_vision: [
    { key: "button_location_id", label: "버튼 POI id", placeholder: "장소 id" },
    { key: "approach_preset", label: "접근 자세 프리셋", placeholder: "door_button" },
  ],
};

const EMPTY_DRAFT: Draft = {
  floorId: "", mapId: "", near: "", far: "",
  controlType: "", detectType: "none",
  openTimeoutSec: 20, passTimeoutSec: 30, controlConfig: {},
};

function toDraft(d: DoorDto): Draft {
  const cfg: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.controlConfig || {})) cfg[k] = v == null ? "" : String(v);
  return {
    floorId: d.floorId ?? "",
    mapId: d.mapId ?? "",
    near: d.nearLocationId ?? "",
    far: d.farLocationId ?? "",
    controlType: d.controlType ?? "",
    detectType: d.detectType || "none",
    openTimeoutSec: d.openTimeoutSec ?? 20,
    passTimeoutSec: d.passTimeoutSec ?? 30,
    controlConfig: cfg,
  };
}

// 통과 POI 셀렉트 값 — 미지정도 하나의 선택지라 빈 id("")를 그대로 쓴다.
function poiValue(places: PlaceItem[], id: number | ""): PoiOption {
  const p = places.find((x) => x.id === id);
  return p ? { id: p.id, label: p.LacationName || `#${p.id}` } : { id: "", label: "미지정" };
}

function isComplete(d: Draft): boolean {
  return !!(d.mapId && d.near && d.far && d.controlType);
}

export default function DoorPanel({ businessId, floors, toolbarSlot, onFacilityChanged, onDraftFloor }: Props) {
  const [doors, setDoors] = useState<DoorDto[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [floorMaps, setFloorMaps] = useState<Record<number, MapItem[]>>({});
  const [mapPlaces, setMapPlaces] = useState<Record<number, PlaceItem[]>>({});
  const [saving, setSaving] = useState(false);
  const { modal, modalAlert, modalConfirm, closeModal, handleConfirm } = useModalAlert();
  const [nameModal, setNameModal] = useState<{ open: boolean; mode: "create" | "rename"; initial: string }>(
    { open: false, mode: "create", initial: "" }
  );

  const selected = doors.find((d) => d.id === selectedId) ?? null;

  const fetchDoors = useCallback(async (biz: number) => {
    try {
      const res = await apiFetch(`/door?business_id=${biz}`);
      const data: DoorDto[] = res.ok ? await res.json() : [];
      setDoors(data);
      setSelectedId((prev) => (data.some((d) => d.id === prev) ? prev : data[0]?.id ?? null));
    } catch {
      setDoors([]);
      setSelectedId(null);
    }
  }, []);

  useEffect(() => {
    if (businessId !== "") fetchDoors(businessId as number);
  }, [businessId, fetchDoors]);

  useEffect(() => {
    setDraft(selected ? toDraft(selected) : EMPTY_DRAFT);
  }, [selectedId, doors]);

  // 편집 중 초안을 층 스택에 즉시 반영(층을 바꾸면 뱃지도 그 층으로 옮겨 간다)
  useEffect(() => {
    onDraftFloor(
      selectedId,
      selected
        ? { floorId: draft.floorId === "" ? null : (draft.floorId as number), complete: isComplete(draft) }
        : null
    );
  }, [selectedId, selected, draft, onDraftFloor]);

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

  useEffect(() => {
    if (draft.floorId !== "") ensureMaps(draft.floorId as number);
    if (draft.mapId !== "") ensurePlaces(draft.mapId as number);
  }, [draft.floorId, draft.mapId, ensureMaps, ensurePlaces]);

  const maps = draft.floorId === "" ? [] : (floorMaps[draft.floorId as number] ?? []);
  const places = draft.mapId === "" ? [] : (mapPlaces[draft.mapId as number] ?? []);
  const placeOptions = useMemo<PoiOption[]>(
    () => [{ id: "", label: "미지정" }, ...places.map((p) => ({ id: p.id, label: p.LacationName || `#${p.id}` }))],
    [places]
  );

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((p) => {
      const next = { ...p, [key]: value };
      // 층이 바뀌면 맵·POI 가 무효, 맵이 바뀌면 POI 가 무효 (서버 규칙과 동일)
      if (key === "floorId") { next.mapId = ""; next.near = ""; next.far = ""; }
      if (key === "mapId") { next.near = ""; next.far = ""; }
      if (key === "controlType") next.controlConfig = {};
      return next;
    });
  };

  const setConfig = (key: string, value: string) =>
    setDraft((p) => ({ ...p, controlConfig: { ...p.controlConfig, [key]: value } }));

  const submitName = async (name: string) => {
    const mode = nameModal.mode;
    setNameModal((p) => ({ ...p, open: false }));
    try {
      if (mode === "create") {
        if (businessId === "") return;
        const res = await apiFetch(`/door`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ business_id: businessId, name }),
        });
        if (!res.ok) throw new Error();
        const created: DoorDto = await res.json();
        await fetchDoors(businessId as number);
        setSelectedId(created.id);
        onFacilityChanged();
      } else {
        if (selectedId == null) return;
        const res = await apiFetch(`/door/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) throw new Error();
        await fetchDoors(businessId as number);
        onFacilityChanged();
      }
    } catch {
      modalAlert(mode === "create" ? "자동문 생성에 실패했습니다." : "이름 변경에 실패했습니다.");
    }
  };

  const deleteDoor = () => {
    if (selectedId == null || !selected) return;
    modalConfirm(`'${selected.name}' 자동문을 삭제할까요?\n등록된 통과 POI·개폐 설정도 함께 삭제됩니다.`, async () => {
      const res = await apiFetch(`/door/${selectedId}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedId(null);
        await fetchDoors(businessId as number);
        onFacilityChanged();
      } else modalAlert("삭제에 실패했습니다.");
    });
  };

  const save = async () => {
    if (selectedId == null) return;
    if (draft.near !== "" && draft.near === draft.far) {
      modalAlert("안쪽·바깥쪽 통과 POI는 서로 다른 장소여야 합니다.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/door/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          floor_id: draft.floorId === "" ? null : draft.floorId,
          map_id: draft.mapId === "" ? null : draft.mapId,
          near_location_id: draft.near === "" ? null : draft.near,
          far_location_id: draft.far === "" ? null : draft.far,
          control_type: draft.controlType === "" ? null : draft.controlType,
          control_config: draft.controlConfig,
          detect_type: draft.detectType,
          open_timeout_sec: draft.openTimeoutSec,
          pass_timeout_sec: draft.passTimeoutSec,
        }),
      });
      if (!res.ok) throw new Error();
      await fetchDoors(businessId as number);
      onFacilityChanged();
      modalAlert("저장되었습니다.");
    } catch {
      modalAlert("저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const complete = isComplete(draft);
  const missing: string[] = [];
  if (!draft.mapId) missing.push("맵");
  if (!draft.near || !draft.far) missing.push("통과 POI(안쪽·바깥쪽)");
  if (!draft.controlType) missing.push("개폐 방식");

  const toolbar = (
    <>
      <CustomSelect
        options={doors.map((d) => ({ id: d.id, label: d.name }))}
        value={selected ? { id: selected.id, label: selected.name } : null}
        onChange={(o) => setSelectedId(Number(o.id))}
        placeholder={doors.length ? "자동문 선택" : "자동문 없음"}
        width={190}
        overlay
        disabled={doors.length === 0}
      />
      <button className={styles.btn} onClick={() => setNameModal({ open: true, mode: "create", initial: "" })} disabled={businessId === ""}>
        + 자동문
      </button>
      {selectedId != null && (
        <button className={styles.btn} onClick={() => setNameModal({ open: true, mode: "rename", initial: selected?.name ?? "" })}>
          이름 변경
        </button>
      )}
      {selectedId != null && (
        <button className={`${styles.btn} ${styles.btnDanger}`} onClick={deleteDoor}>삭제</button>
      )}
      <button className={`${styles.btn} ${styles.btnPri}`} onClick={save} disabled={selectedId == null || saving}>
        {saving ? "저장 중..." : "저장"}
      </button>
    </>
  );

  return (
    <>
      {toolbarSlot && createPortal(toolbar, toolbarSlot)}

      {selectedId == null ? (
        <div className={styles.empty}>자동문을 선택하거나 새로 추가하세요.</div>
      ) : (
        <div className={styles.doorCard}>
          <div className={styles.dcHead}>
            <h4>{selected?.name}</h4>
            <span className={styles.loc}>door#{selectedId}</span>
            <span className={styles.dcHeadRight}>
              <span className={`${styles.badge} ${complete ? styles.badgeOk : styles.badgeWarn}`}>
                {complete ? "등록 완료" : "미완료"}
              </span>
            </span>
          </div>

          <div className={styles.fgrid}>
            <div className={styles.frow}>
              <label>층 <span className={styles.req}>*</span></label>
              <CustomSelect
                options={floors.map((f) => ({ id: f.id, label: f.label }))}
                value={(() => { const f = floors.find((x) => x.id === draft.floorId); return f ? { id: f.id, label: f.label } : null; })()}
                onChange={(o) => setField("floorId", Number(o.id))}
                placeholder="층 선택"
                error={!draft.floorId}
                overlay
                width="100%"
              />
            </div>
            <div className={styles.frow}>
              <label>맵 <span className={styles.req}>*</span></label>
              <CustomSelect
                options={maps.map((m) => ({ id: m.id, label: m.MapName }))}
                value={(() => { const m = maps.find((x) => x.id === draft.mapId); return m ? { id: m.id, label: m.MapName } : null; })()}
                onChange={(o) => setField("mapId", Number(o.id))}
                placeholder={draft.floorId === "" ? "층 먼저" : maps.length ? "맵 선택" : "맵 없음"}
                disabled={draft.floorId === "" || maps.length === 0}
                error={!draft.mapId}
                overlay
                width="100%"
              />
            </div>

            <div className={`${styles.frow} ${styles.frowFull}`}>
              <label>통과 POI <span className={styles.req}>*</span></label>
              <div className={styles.pair}>
                <div className={styles.pairItem}>
                  <CustomSelect
                    options={placeOptions}
                    value={poiValue(places, draft.near)}
                    onChange={(o) => setField("near", o.id === "" ? "" : Number(o.id))}
                    placeholder={places.length ? "미지정" : "맵 먼저"}
                    disabled={draft.mapId === ""}
                    error={!draft.near}
                    overlay
                    width="100%"
                  />
                  <span className={styles.pairTag}>안쪽 (문 안)</span>
                </div>
                <span className={styles.pairArrow}>→</span>
                <div className={styles.pairItem}>
                  <CustomSelect
                    options={placeOptions}
                    value={poiValue(places, draft.far)}
                    onChange={(o) => setField("far", o.id === "" ? "" : Number(o.id))}
                    placeholder={places.length ? "미지정" : "맵 먼저"}
                    disabled={draft.mapId === ""}
                    error={!draft.far}
                    overlay
                    width="100%"
                  />
                  <span className={styles.pairTag}>바깥 (문 밖)</span>
                </div>
              </div>
              <div className={styles.hint}>
                맵 편집에서 찍은 장소를 연결합니다(새 좌표 입력 없음). 두 점의 <b>순서</b>가 통과 방향이고,
                반대 방향 통과는 자동으로 바깥 → 안쪽으로 해석됩니다.
              </div>
            </div>

            <div className={styles.frow}>
              <label>개폐 방식 <span className={styles.req}>*</span></label>
              <CustomSelect
                options={CONTROL_TYPES}
                value={CONTROL_TYPES.find((c) => c.id === draft.controlType) ?? null}
                onChange={(o) => setField("controlType", String(o.id))}
                placeholder="개폐 방식 선택"
                error={!draft.controlType}
                overlay
                width="100%"
              />
            </div>
            <div className={styles.frow}>
              <label>문 열림 확인</label>
              <CustomSelect
                options={DETECT_TYPES}
                value={DETECT_TYPES.find((d) => d.id === draft.detectType) ?? DETECT_TYPES[0]}
                onChange={(o) => setField("detectType", String(o.id))}
                placeholder="확인 방법 선택"
                overlay
                width="100%"
              />
            </div>

            {(CONFIG_FIELDS[draft.controlType] ?? []).map((f) => (
              <div key={f.key} className={styles.frow}>
                <label>{f.label}</label>
                <div className={styles.numField}>
                  <input
                    type="text"
                    style={{ textAlign: "left" }}
                    placeholder={f.placeholder}
                    value={draft.controlConfig[f.key] ?? ""}
                    onChange={(e) => setConfig(f.key, e.target.value)}
                  />
                </div>
              </div>
            ))}

            <div className={`${styles.frow} ${styles.frowFull}`}>
              <label>타임아웃</label>
              <div className={styles.numRow}>
                <div className={styles.numField}>
                  <span>열림 대기</span>
                  <input
                    type="number" min={1} max={600}
                    value={draft.openTimeoutSec}
                    onChange={(e) => setField("openTimeoutSec", Number(e.target.value))}
                  />
                  <span>초</span>
                </div>
                <div className={styles.numField}>
                  <span>통과 제한</span>
                  <input
                    type="number" min={1} max={600}
                    value={draft.passTimeoutSec}
                    onChange={(e) => setField("passTimeoutSec", Number(e.target.value))}
                  />
                  <span>초</span>
                </div>
              </div>
              <div className={styles.hint}>
                열림 대기를 넘기면 조작자 개입을 요청하고, 통과 제한을 넘기면 <b>후진 폴백</b>합니다(전진 강행 금지).
              </div>
            </div>
          </div>

          {draft.controlType === "auto_sensor" && draft.detectType === "none" && (
            <div className={`${styles.inline} ${styles.inlineWarn}`}>
              <span className={styles.inlineIco} />
              <div>
                <b>자동 센서가 4족 로봇을 감지하지 못할 수 있습니다.</b> 낮은 실루엣에 열원이 없어서입니다.
                문 열림 확인을 <b>카메라로 확인</b>으로 두면 열렸다고 가정하지 않고 실제로 열린 것을 보고 진입합니다.
                센서가 못 잡는 게 확인되면 개폐 방식을 접점/릴레이 · 로봇 팔로 버튼 누름 · 상시 개방으로 바꾸세요.
              </div>
            </div>
          )}

          {!complete && (
            <div className={`${styles.inline} ${styles.inlineErr}`}>
              <span className={styles.inlineIco} />
              <div>
                <b>아직 로봇이 이 문을 지나갈 수 없습니다.</b> {missing.join(" · ")}이(가) 비어 있습니다.
                채우면 <b>등록 완료</b>로 바뀌고 자동 통과가 시작됩니다.
                그때까지 이 문 앞에서는 로봇이 멈춰 서서 조작자를 기다립니다.
              </div>
            </div>
          )}
        </div>
      )}

      <ElevatorNameModal
        open={nameModal.open}
        title={nameModal.mode === "create" ? "자동문 추가" : "자동문 이름 변경"}
        initial={nameModal.initial}
        placeholder="자동문 이름 (예: 본관 1층 정문)"
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
