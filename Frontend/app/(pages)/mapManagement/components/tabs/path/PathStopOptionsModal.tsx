"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PathStopOptionsModal.module.css";
import CustomSelect, { type SelectOption } from "@/app/components/select/CustomSelect";
import VoiceConfirmWordModal from "@/app/(pages)/dataManagement/components/tabs/voice/VoiceConfirmWordModal";
import { apiFetch } from "@/app/lib/api";

// 경유지 도착 상호작용 — 시간(waitSeconds)은 별도, 아래 4필드가 StopAction.
export type StopConfirm = "none" | "button" | "voice";
export type StopOnTimeout = "wait" | "skip" | "abort";

export type StopAction = {
  announceId: number | null;
  announceText: string | null;
  confirm: StopConfirm;
  onTimeout: StopOnTimeout;
};

export type AnnouncementOption = { id: number; label: string; text: string };

type Props = {
  isOpen: boolean;
  placeName: string;
  initialWaitSeconds: number;
  onCancel: () => void;
  onConfirm: (waitSeconds: number, stopAction: StopAction) => void;
  // 도착 발화·확인 기능 (경로 관리에서만). 미지정 시 기존 '대기 시간' 전용 모달.
  enableInteraction?: boolean;
  initialStopAction?: StopAction | null;
  announcements?: AnnouncementOption[];
  /** 확인 인식어(사용 중인 것). 확인 방식이 '음성'일 때 무슨 말이 통과인지 보여준다 */
  confirmWords?: string[];
  /** 인식어 관리 모달을 여는 데 필요 */
  voiceRobotId?: number | null;
};

const MIN_WAIT = 0;
const MAX_WAIT = 600;

const DEFAULT_ACTION: StopAction = {
  announceId: null,
  announceText: null,
  confirm: "none",
  onTimeout: "wait",
};

export default function PathStopOptionsModal({
  isOpen,
  placeName,
  initialWaitSeconds,
  onCancel,
  onConfirm,
  enableInteraction = false,
  initialStopAction = null,
  announcements = [],
  confirmWords = [],
  voiceRobotId = null,
}: Props) {
  const [waitInput, setWaitInput] = useState<string>("0");
  const [announceId, setAnnounceId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<StopConfirm>("none");
  const [onTimeout, setOnTimeout] = useState<StopOnTimeout>("wait");
  const [error, setError] = useState<string | null>(null);
  const [wordModalOpen, setWordModalOpen] = useState(false);
  // 인식어를 고쳤을 때 미리보기가 따라오도록 로컬로 덮어쓴다(부모 재조회를 기다리지 않는다)
  const [wordsOverride, setWordsOverride] = useState<string[] | null>(null);

  const words = wordsOverride ?? confirmWords;

  // 선택한 멘트의 실제 문장. 경고 판정은 이걸로 한다.
  const announceText = useMemo(
    () => (announceId != null ? announcements.find((a) => a.id === announceId)?.text ?? "" : ""),
    [announceId, announcements],
  );
  // 멘트가 인식어를 하나도 유도하지 않으면 손님이 그대로 말해도 통과되지 않는다.
  const announceHasWord = useMemo(
    () => words.some((w) => announceText.includes(w)),
    [words, announceText],
  );

  // 부모(RemoteModal 등)가 폴링으로 자주 리렌더돼도 초기값이 사용자 입력을 덮어쓰지 않게 ref 로 최신 onCancel 참조.
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!isOpen) return;
    setWaitInput(String(initialWaitSeconds ?? 0));
    const a = initialStopAction ?? DEFAULT_ACTION;
    setAnnounceId(a.announceId);
    setConfirm(a.confirm);
    setOnTimeout(a.onTimeout);
    setError(null);

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancelRef.current();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [isOpen, initialWaitSeconds, initialStopAction]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    const parsed = Number(waitInput);
    if (!Number.isFinite(parsed) || parsed < MIN_WAIT || parsed > MAX_WAIT) {
      setError(`0 이상 ${MAX_WAIT} 이하의 숫자를 입력해 주세요.`);
      return;
    }
    // 삭제된 멘트를 가리키면(목록에 없음) 발화 없음으로 처리 → announceId=null
    const picked = announceId != null ? announcements.find((x) => x.id === announceId) : null;
    onConfirm(Math.floor(parsed), {
      announceId: picked ? picked.id : null,
      announceText: picked ? picked.text : null,
      confirm,
      onTimeout,
    });
  };

  const waitLabel = confirm === "none" ? "대기 시간" : "최대 대기";
  const waitHelp =
    confirm === "none"
      ? `도착 후 다음 장소로 이동하기 전 정지할 시간 (0 ~ ${MAX_WAIT}초)`
      : "사람이 확인하면 남은 시간 무시하고 즉시 이동. 아무도 확인 안 하면 이 시간 후 아래 정책.";

  // 조기 반환(!isOpen) 뒤라 훅을 쓰면 안 된다 — 일반 상수로 계산.
  const announceOptions: SelectOption[] = [
    { id: 0, label: "없음 — 발화 안 함" },
    ...announcements.map((a) => ({
      id: a.id,
      label: a.label || a.text,
    })),
  ];
  const confirmOptions: SelectOption[] = [
    { id: "none", label: "없음 (시간만 대기)" },
    { id: "button", label: "버튼 (확인 눌러야 이동)" },
    { id: "voice", label: "음성 (마이크 필요)" },
  ];
  const onTimeoutOptions: SelectOption[] = [
    { id: "wait", label: "계속 대기" },
    { id: "skip", label: "다음 경유지로 건너뛰기" },
    { id: "abort", label: "작업 중단" },
  ];

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.box} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onCancel} aria-label="close">
          ✕
        </button>

        <div className={styles.title}>도착 지점 정지·안내 설정</div>
        <div className={styles.subtitle}>{placeName}</div>

        {enableInteraction && (
          <>
            {/* 도착 발화 — 안내 멘트의 발화명으로 고른다 */}
            <div className={styles.formRow}>
              <label className={styles.label}>발화명</label>
              <div className={styles.selectWrap}>
                <CustomSelect
                  options={announceOptions}
                  value={announceOptions.find((o) => o.id === (announceId ?? 0)) ?? announceOptions[0]}
                  onChange={(o) => setAnnounceId(Number(o.id) || null)}
                  placeholder="선택"
                  width="100%"
                  overlay
                />
              </div>
            </div>
            <div className={styles.help}>음성 관리 › 안내 멘트에서 등록한 발화명을 고릅니다.</div>

            {/* 확인 */}
            <div className={styles.formRow} style={{ marginTop: 12 }}>
              <label className={styles.label}>확인</label>
              <div className={styles.selectWrap}>
                <CustomSelect
                  options={confirmOptions}
                  value={confirmOptions.find((o) => o.id === confirm) ?? confirmOptions[0]}
                  onChange={(o) => setConfirm(o.id as StopConfirm)}
                  placeholder="선택"
                  width="100%"
                  overlay
                />
              </div>
            </div>
            <div className={styles.help}>확인이 있으면 사람이 확인해야 다음 경유지로 이동합니다.</div>

            <div className={styles.divider} />
          </>
        )}

        {/* 최대 대기 / 대기 시간 */}
        <div className={styles.formRow}>
          <label className={styles.label}>{waitLabel}</label>
          <div className={styles.inputWrap}>
            <input
              className={styles.input}
              type="number"
              min={MIN_WAIT}
              max={MAX_WAIT}
              step={1}
              value={waitInput}
              onChange={(e) => {
                setWaitInput(e.target.value);
                if (error) setError(null);
              }}
            />
            <span className={styles.unit}>초</span>
          </div>
        </div>
        <div className={styles.help}>{waitHelp}</div>
        {error && <div className={styles.error}>{error}</div>}

        {/* 확인 방식이 '음성'이면 무슨 말이 통과인지 여기서 보여준다.
            멘트를 쓰는 화면과 인식어가 떨어져 있으면 서로 어긋나도 알 수가 없다. */}
        {confirm === "voice" && words.length > 0 && (
          <>
            <div className={styles.confirmWordHint}>
              확인 인식어 — <b>{words.slice(0, 6).join(" · ")}</b>
              {words.length > 6 && ` 외 ${words.length - 6}개`}
              {voiceRobotId != null && (
                <button
                  type="button"
                  className={styles.confirmWordManage}
                  onClick={() => setWordModalOpen(true)}
                >
                  인식어 관리
                </button>
              )}
            </div>
            {announceText.trim() !== "" && !announceHasWord && (
              <div className={styles.confirmWordWarn}>
                <b>이 멘트는 인식어를 유도하지 않습니다.</b>{" "}
                손님이 멘트대로 말해도 통과되지 않을 수 있습니다. 위 목록의 말을 멘트에 넣어 주세요.
              </div>
            )}
          </>
        )}

        {/* 무응답 시 (확인이 있을 때만) */}
        {confirm !== "none" && (
          <>
            <div className={styles.formRow} style={{ marginTop: 12 }}>
              <label className={styles.label}>무응답 시</label>
              <div className={styles.selectWrap}>
                <CustomSelect
                  options={onTimeoutOptions}
                  value={onTimeoutOptions.find((o) => o.id === onTimeout) ?? onTimeoutOptions[0]}
                  onChange={(o) => setOnTimeout(o.id as StopOnTimeout)}
                  placeholder="선택"
                  width="100%"
                  overlay
                />
              </div>
            </div>
            <div className={styles.help}>최대 대기까지 아무도 확인 안 했을 때의 동작입니다.</div>
          </>
        )}

        <div className={styles.footer}>
          <button className={`${styles.btn} ${styles.btnRed}`} onClick={onCancel}>
            <img src="/icon/close_btn.png" alt="" />
            취소
          </button>
          <button className={`${styles.btn} ${styles.btnBlue}`} onClick={handleConfirm}>
            <img src="/icon/check.png" alt="" />
            확인
          </button>
        </div>
      </div>

      {wordModalOpen && voiceRobotId != null && (
        <VoiceConfirmWordModal
          robotId={voiceRobotId}
          onClose={() => setWordModalOpen(false)}
          onChanged={async () => {
            // 고친 결과를 미리보기·경고에 바로 반영한다(모달을 닫았다 다시 열지 않아도 되게)
            try {
              const res = await apiFetch(`/DB/robots/${voiceRobotId}/voice-confirm-words`);
              if (!res.ok) return;
              const data = await res.json();
              const items = (data.items ?? []).filter((w: { isActive: boolean }) => w.isActive);
              setWordsOverride(items.length ? items.map((w: { word: string }) => w.word) : (data.defaults ?? []));
            } catch {
              /* 갱신 실패는 설정 저장을 막지 않는다 */
            }
          }}
        />
      )}
    </div>
  );
}
