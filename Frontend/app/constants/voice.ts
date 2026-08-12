// 음성 Q&A 관리 — 입력 상한 단일 출처.
// 이 숫자들은 백엔드(app/database/routes/voice.py)와 반드시 같아야 한다.
// 한 곳이라도 어긋나면 "UI에선 됐는데 저장이 안 되는" 버그가 난다.

export const VOICE_LIMITS = {
  displayName: 40,
  exampleText: 60,
  responseText: 400,
  synonyms: 300,
  fallback: 300,
  search: 40,
  minExamples: 2,
  maxExamples: 20,
  minResponses: 1,
  maxResponses: 20,
  importRows: 200,
} as const;

// 목적지는 시스템이 주는 하나뿐인 토큰이다.
// 운영자가 {환자명} 같은 새 변수를 만들 수는 없다.
export const SLOT_TOKEN = "{목적지}";

export type VoiceActionType = "none" | "navigate" | "stop";

// 드롭다운에 '결과'를 함께 쓴다 — "안내"라는 단어만 봐서는
// 로봇이 실제로 움직인다는 걸 알 수 없다.
export const VOICE_ACTIONS: {
  value: VoiceActionType;
  label: string;
  hint: string;
}[] = [
  { value: "none", label: "없음", hint: "음성 안내만 하고 이동하지 않습니다" },
  { value: "navigate", label: "안내", hint: "음성 안내 후 목적지로 이동합니다" },
  { value: "stop", label: "정지", hint: "음성 안내 후 가던 길을 멈춥니다" },
];

export const ACTION_LABEL: Record<VoiceActionType, string> = {
  none: "없음",
  navigate: "안내",
  stop: "정지",
};

// 로봇 적용은 답변 문장을 미리 합성한다(문장당 ~2.6초).
// 기본 타임아웃으로는 어림도 없다.
export const VOICE_SYNC_TIMEOUT_MS = 10 * 60 * 1000;
export const VOICE_PREVIEW_TIMEOUT_MS = 20 * 1000;
