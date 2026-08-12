import { apiFetch } from "@/app/lib/api";
import {
  VOICE_PREVIEW_TIMEOUT_MS,
  VOICE_SYNC_TIMEOUT_MS,
  type VoiceActionType,
} from "@/app/constants/voice";

export type VoiceIntentRow = {
  id: number;
  robotId: number;
  displayName: string;
  actionType: VoiceActionType;
  actionLabel: string;
  exampleCount: number;
  responseCount: number;
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  appliedAt: string | null;
  isApplied: boolean;
};

export type VoiceExample = { id?: number; text: string; isKeyword: boolean };
export type VoiceResponse = { id?: number; text: string };

export type VoiceIntentDetail = {
  id: number;
  robotId: number;
  displayName: string;
  actionType: VoiceActionType;
  isActive: boolean;
  examples: VoiceExample[];
  responses: VoiceResponse[];
  isApplied: boolean;
};

export type VoicePlace = {
  id: number;
  name: string;
  x: number;
  y: number;
  floorId: number | null;
};

export type VoiceSlot = {
  id: number;
  value: string;
  synonyms: string;
  locationId: number | null;
  locationName: string | null;
};

/** 도착 확인 인식어 — 확인 방식이 '음성'일 때 통과로 볼 말 */
/** 인식어 쓰임. 둘은 같은 자리에서 쓰이지 않으므로 섞으면 안 된다 */
export type ConfirmWordKind = "arrival" | "dismiss";

export type VoiceConfirmWord = {
  id: number;
  word: string;
  isActive: boolean;
  sortOrder: number;
};

export type SlotConflict = {
  score: number;
  against: string;
  kind: string;
  slotValue: string;
  level: "warn" | "block";
};

// 안내 멘트 — 경유지 도착 시 로봇이 말할 순수 발화 문구
export type VoiceAnnouncement = {
  id: number;
  text: string;
  label: string;
  isActive: boolean;
  applied: boolean;
};

export type VoiceConfig = {
  fallbackResponse: string;
  matchThreshold: number;
  slotFuzzyThreshold: number;
  confirmOnAction: boolean;
  canEdit: boolean;
};

export type ApplyTarget = {
  robotId: number;
  robotName: string;
  robotType: string | null;
  selectable: boolean;
  reason: string | null;
  isSource: boolean;
  ownIntentCount: number;
};

export type ImportError = { line: number; name: string; reason: string };
export type ImportSummary = {
  totalRows: number;
  created: number;
  updated: number;
  untouched: number;
  untouchedNames: string[];
};

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `요청에 실패했습니다 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch {
      /* 본문이 JSON이 아니면 기본 메시지를 쓴다 */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export type VoiceModule = {
  exists: boolean;
  isActive?: boolean;
  isBuiltIn?: boolean;
  host?: string | null;
  port?: number;
  effectiveHost?: string | null;
  // 능력 플래그 — 상시 대기 호출 방식(mic/button) 게이팅에 쓰인다
  hasMic?: boolean;
  hasSpeaker?: boolean;
  canEdit: boolean;
};

export const voiceApi = {
  // 음성 모듈은 RobotType 으로 추정하지 않는다 — 운영자가 명시적으로 등록한다.
  getModule: (robotId: number) =>
    apiFetch(`/DB/robots/${robotId}/voice-module`).then(unwrap<VoiceModule>),

  saveModule: (robotId: number, body: unknown) =>
    apiFetch(`/DB/robots/${robotId}/voice-module`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string; seededIntents: number }>),

  listIntents: (robotId: number, search?: string) =>
    apiFetch(
      `/DB/robots/${robotId}/voice-intents${
        search ? `?search=${encodeURIComponent(search)}` : ""
      }`
    ).then(unwrap<{ items: VoiceIntentRow[]; total: number; pendingCount: number }>),

  getIntent: (intentId: number) =>
    apiFetch(`/DB/voice-intents/${intentId}`).then(unwrap<VoiceIntentDetail>),

  createIntent: (robotId: number, body: unknown) =>
    apiFetch(`/DB/robots/${robotId}/voice-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string; id: number }>),

  updateIntent: (intentId: number, body: unknown) =>
    apiFetch(`/DB/voice-intents/${intentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string }>),

  bulkDelete: (ids: number[]) =>
    apiFetch(`/DB/voice-intents/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).then(unwrap<{ status: string; deleted: number }>),

  listSlots: (robotId: number) =>
    apiFetch(`/DB/robots/${robotId}/voice-slots`).then(
      unwrap<{
        items: VoiceSlot[];
        places: VoicePlace[];
        total: number;
        linkedCount: number;
      }>
    ),

  createSlot: (robotId: number, body: unknown, force = false) =>
    apiFetch(`/DB/robots/${robotId}/voice-slots?force=${force}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string; id?: number; conflict?: SlotConflict }>),

  updateSlot: (slotId: number, body: unknown, force = false) =>
    apiFetch(`/DB/voice-slots/${slotId}?force=${force}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string; conflict?: SlotConflict }>),

  deleteSlot: (slotId: number) =>
    apiFetch(`/DB/voice-slots/${slotId}`, { method: "DELETE" }).then(
      unwrap<{ status: string }>
    ),

  // ── 음성 인식어 (종류별) ──
  // 판정은 서버 단일 출처다. 화면은 이 목록을 보여주고 고칠 뿐,
  // 어떤 말이 통과인지를 프론트가 따로 정하지 않는다.
  //   arrival = 경유지 도착 확인 / dismiss = 안내 종료(복귀) 확인
  listConfirmWords: (robotId: number, kind: ConfirmWordKind = "arrival") =>
    apiFetch(`/DB/robots/${robotId}/voice-confirm-words?kind=${kind}`).then(
      unwrap<{
        items: VoiceConfirmWord[];
        /** 등록이 없을 때 쓰이는 기본 목록. '출처' 판정에도 쓴다 */
        defaults: string[];
        /** true = 아직 기본으로 동작 중 */
        usingDefaults: boolean;
      }>
    ),

  createConfirmWord: (robotId: number, body: { word: string; isActive?: boolean; sortOrder?: number },
                      kind: ConfirmWordKind = "arrival") =>
    apiFetch(`/DB/robots/${robotId}/voice-confirm-words?kind=${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // seeded = 첫 등록이라 기본 목록을 함께 깔았다는 뜻
    }).then(unwrap<{ status: string; id: number; word: string; seeded: number }>),

  updateConfirmWord: (wordId: number, body: { word: string; isActive?: boolean; sortOrder?: number }) =>
    apiFetch(`/DB/voice-confirm-words/${wordId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string; word: string; isActive: boolean }>),

  deleteConfirmWord: (wordId: number) =>
    apiFetch(`/DB/voice-confirm-words/${wordId}`, { method: "DELETE" }).then(
      unwrap<{ status: string }>
    ),

  resetConfirmWords: (robotId: number, kind: ConfirmWordKind = "arrival") =>
    apiFetch(`/DB/robots/${robotId}/voice-confirm-words/reset?kind=${kind}`, { method: "POST" }).then(
      unwrap<{ status: string; count: number }>
    ),

  // ── 안내 멘트 (경유지 도착 상호작용) ──
  listAnnouncements: (robotId: number) =>
    apiFetch(`/DB/robots/${robotId}/voice-announcements`).then(
      unwrap<{ items: VoiceAnnouncement[] }>
    ),

  createAnnouncement: (robotId: number, body: unknown) =>
    apiFetch(`/DB/robots/${robotId}/voice-announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string; id?: number }>),

  updateAnnouncement: (id: number, body: unknown) =>
    apiFetch(`/DB/voice-announcements/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string }>),

  deleteAnnouncement: (id: number) =>
    apiFetch(`/DB/voice-announcements/${id}`, { method: "DELETE" }).then(
      unwrap<{ status: string }>
    ),

  getConfig: (robotId: number) =>
    apiFetch(`/DB/robots/${robotId}/voice-config`).then(unwrap<VoiceConfig>),

  updateConfig: (robotId: number, body: unknown) =>
    apiFetch(`/DB/robots/${robotId}/voice-config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(unwrap<{ status: string }>),

  applyTargets: (robotId: number) =>
    apiFetch(`/DB/robots/${robotId}/voice-apply-targets`).then(
      unwrap<{ items: ApplyTarget[] }>
    ),

  // 미리듣기는 로봇이 만든 소리를 그대로 받아온다(관제에 TTS를 두 벌 만들지 않는다).
  preview: async (robotId: number, text: string, dest: string | null) => {
    const res = await apiFetch(`/DB/robots/${robotId}/voice-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, dest }),
      timeoutMs: VOICE_PREVIEW_TIMEOUT_MS,
    });
    if (!res.ok) {
      let detail = "소리를 들을 수 없습니다";
      try {
        const body = await res.json();
        if (body?.detail) detail = body.detail;
      } catch {
        /* noop */
      }
      throw new Error(detail);
    }
    return URL.createObjectURL(await res.blob());
  },

  // 로봇 동작 명령 — 관제에 이미 있는 /robot/* 를 그대로 호출한다(음성과 무관, 검증용).
  // ⚠ 로봇 하드웨어가 실제로 움직인다. 사족보행(4족) 로봇에서만 의미가 있다.
  motion: (cmd: "sit" | "stand" | "leftTurn" | "rightTurn" | "stop") =>
    apiFetch(`/robot/${cmd}`, { method: "POST", timeoutMs: 10_000 }).then(
      unwrap<{ status: string }>
    ),

  // 리허설 — 로봇 스피커로 말하고, 목적지가 연결돼 있으면 실제로 이동시킨다.
  // ⚠ 로봇 하드웨어를 실제로 움직인다.
  rehearse: (robotId: number, text: string, dest: string | null, move: boolean) =>
    apiFetch(`/DB/robots/${robotId}/voice-rehearse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, dest, move }),
      timeoutMs: 40_000,
    }).then(
      unwrap<{
        status: string;
        steps: { step: string; ok: boolean; msg?: string; spoken?: string }[];
        moved: { locationId: number } | null;
      }>
    ),

  // 로봇 적용 — NDJSON 스트리밍(맵 동기화와 같은 패턴)
  sync: (robotId: number, robotIds: number[]) =>
    apiFetch(`/DB/robots/${robotId}/voice-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ robotIds }),
      timeoutMs: VOICE_SYNC_TIMEOUT_MS,
    }),

  /** 양식 다운로드 = 빈 양식(헤더 + 예시 1줄).
   *
   *  현재 등록된 목록을 그대로 내려주면, 새로 작성하려는 사람이 "이게 내 데이터인지
   *  양식인지" 헷갈린다. 그래서 현재 데이터가 아니라 헤더 + 예시 한 줄만 준다.
   *  헤더는 백엔드 CSV_HEADER 와 정확히 일치해야 한다(불일치 시 업로드가 거부됨).
   *  xlsx 로 주는 이유: CSV 는 한국어 엑셀이 CP949 로 저장해 한글이 깨질 수 있다. */
  downloadTemplate: async (_robotId: number, robotName: string) => {
    const XLSX = await import("xlsx");
    const rows: (string | number)[][] = [
      ["시나리오명", "동작", "질문", "답변", "활성"],
      ["예시_길안내 (지우고 작성)", "안내", "{목적지}로 안내해줘|{목적지} 어디예요", "{목적지}로 안내하겠습니다", 1],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    // 열 폭 — 안 주면 전부 좁아서 내용이 안 보인다
    ws["!cols"] = [{ wch: 24 }, { wch: 8 }, { wch: 60 }, { wch: 60 }, { wch: 6 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "voice");
    const now = new Date();
    const ymd =
      `${now.getFullYear()}` +
      `${String(now.getMonth() + 1).padStart(2, "0")}` +
      `${String(now.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `${robotName}_음성양식_${ymd}.xlsx`);
  },

  /** 업로드 파일을 CSV 텍스트로 정규화한다.
   *  xlsx/xls 는 브라우저에서 CSV 로 바꿔 보낸다 — 백엔드는 CSV 하나만 알면 된다. */
  toCsvFile: async (file: File): Promise<File> => {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    if (!isExcel) return file;

    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      throw new Error("엑셀에 시트가 없습니다. 양식을 내려받아 작성해 주세요.");
    }
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
    return new File([csv], file.name.replace(/\.(xlsx|xls)$/i, ".csv"), {
      type: "text/csv",
    });
  },

  importCsv: (robotId: number, file: File, dryRun: boolean) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch(
      `/DB/robots/${robotId}/voice-intents/import?dryRun=${dryRun}`,
      { method: "POST", body: form, timeoutMs: 60_000 }
    ).then(
      unwrap<{
        status: "ok" | "invalid";
        errors: ImportError[];
        summary: ImportSummary;
      }>
    );
  },
};
