/**
 * 카메라 스트림 상태 문구 — 모든 카메라 화면(대시보드 슬롯·확대 모달·원격제어)이
 * 이 파일 하나만 본다. 문구를 바꾸려면 여기만 고치면 된다.
 *
 * 원칙: 기술 용어를 쓰지 않고, **지금 기다리면 되는지 / 눌러야 하는지**를 알려준다.
 *  - 자동으로 복구되는 상태 → "자동으로" 라고 분명히 적는다(사용자가 새로고침하지 않도록).
 *  - 사람이 눌러야 하는 상태 → 버튼을 함께 띄운다.
 */

export type StreamPhase =
  | "connecting"  // 최초 연결 시도 중
  | "recovering"  // 일시 끊김 — 자동 복구 시도 중
  | "waiting"     // 카메라에서 영상이 오지 않음 — 신호가 오면 자동 연결
  | "error"       // 자동 복구 포기 — 사용자가 눌러야 함
  | "disabled";   // 연결을 시도하지 않는 상태(로봇 오프라인 등)

export type StreamCopy = {
  /** 큰 글씨 — 작은 슬롯에서는 이것만 보인다 */
  title: string;
  /** 작은 글씨 — 지금 뭘 해야 하는지(또는 안 해도 되는지) */
  desc: string;
  /** 스피너를 함께 보여줄지 */
  spinner: boolean;
  /** '다시 연결' 버튼을 함께 보여줄지 */
  retry: boolean;
};

export const STREAM_COPY: Record<StreamPhase, StreamCopy> = {
  connecting: {
    title: "연결 중...",
    desc: "",
    spinner: true,
    retry: false,
  },
  recovering: {
    title: "다시 연결 중...",
    desc: "자동으로 복구하고 있습니다",
    spinner: true,
    retry: false,
  },
  waiting: {
    title: "카메라 영상 대기 중",
    desc: "신호가 오면 자동으로 표시됩니다",
    spinner: false,
    retry: false,
  },
  error: {
    title: "영상을 불러오지 못했습니다",
    desc: "아래 버튼을 눌러 다시 시도해 주세요",
    spinner: false,
    retry: true,
  },
  disabled: {
    title: "연결 대기",
    desc: "",
    spinner: false,
    retry: false,
  },
};

/** 라이브 배지 문구 */
export const LIVE_LABEL = "LIVE";
/** 재연결 버튼 문구 */
export const RETRY_LABEL = "다시 연결";
