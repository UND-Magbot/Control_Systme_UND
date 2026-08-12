"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Play, Square, X, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/app/components/common/Toast";
import CustomSelect from "@/app/components/select/CustomSelect";
import {
  ACTION_LABEL,
  SLOT_TOKEN,
  VOICE_ACTIONS,
  VOICE_LIMITS,
  type VoiceActionType,
} from "@/app/constants/voice";
import styles from "./voice.module.css";
import {
  voiceApi,
  type VoiceExample,
  type VoiceResponse,
  type VoiceSlot,
} from "./voiceApi";
import VoiceSlotModal from "./VoiceSlotModal";

type Props = {
  robotId: number;
  intentId: number | null; // null = 신규
  onClose: () => void;
  onSaved: () => void;
};

const TOKEN_RE = /\{([^}]*)\}/g;

// 질문 섹션 참고 설명 — 제목 옆 (?) 툴팁으로. 짧은 규칙(최소 개수)만 인라인에 남긴다.
const QUESTION_HELP = [
  `[목적지 넣기]는 커서 자리에 ${SLOT_TOKEN}를 넣어주는 편의 버튼입니다.`,
  `${SLOT_TOKEN}는 고객이 말한 목적지로 채워지고, 그 값을 '목적지 사전'과 대조해 어디로 갈지 판단합니다.`,
  `특정 목적지를 고르는 게 아니라, 이 시나리오 하나가 사전에 등록된 모든 목적지(응급실·2층 …)에 동작합니다.`,
  `'키워드형'은 소음·단답 대비용입니다.`,
].join("\n");

/** 중괄호를 썼는데 알 수 없는 토큰이면 매칭이 '조용히' 실패한다 — 입력 중에 잡는다. */
function badToken(text: string): string | null {
  for (const m of text.matchAll(TOKEN_RE)) {
    if (m[1] !== "목적지") return m[0];
  }
  return null;
}

export default function VoiceScenarioDetail({ robotId, intentId, onClose, onSaved }: Props) {
  const { showToast } = useToast();

  const [displayName, setDisplayName] = useState("");
  const [actionType, setActionType] = useState<VoiceActionType>("none");
  const [isActive, setIsActive] = useState(true);
  const [examples, setExamples] = useState<VoiceExample[]>([
    { text: "", isKeyword: false },
    { text: "", isKeyword: false },
  ]);
  const [responses, setResponses] = useState<VoiceResponse[]>([{ text: "" }]);

  const [slots, setSlots] = useState<VoiceSlot[]>([]);
  // 목적지 사전 모달을 이 화면에서 연다(=시나리오 작성 흐름을 끊지 않는다)
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [previewDest, setPreviewDest] = useState<string | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [synthIdx, setSynthIdx] = useState<number | null>(null);
  const [previewBlocked, setPreviewBlocked] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [guardOpen, setGuardOpen] = useState(false);
  const [rehearseOpen, setRehearseOpen] = useState(false);
  const [rehearsing, setRehearsing] = useState(false);
  const [motionBusy, setMotionBusy] = useState(false);
  type MotionCmd = "sit" | "stand" | "leftTurn" | "rightTurn" | "stop";
  const [motionConfirm, setMotionConfirm] = useState<MotionCmd | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(intentId !== null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 질문/답변을 '따로' 기억한다. 하나만 두면 질문 버튼을 눌러도
  // 직전에 만진 게 답변이면 답변에 꽂힌다(실제로 그랬다).
  const lastEx = useRef<{ idx: number; pos: number } | null>(null);
  const lastRs = useRef<{ idx: number; pos: number } | null>(null);

  // 목적지 사전을 이 화면에서 바로 고칠 수 있어야 한다(시나리오를 쓰다 말고 다른 탭으로
  // 건너가지 않도록). 모달을 닫으면 다시 불러 방금 등록한 목적지가 즉시 반영된다.
  const reloadSlots = useCallback(async () => {
    try {
      const slotRes = await voiceApi.listSlots(robotId);
      setSlots(slotRes.items);
      setPreviewDest((prev) =>
        prev || (slotRes.items.length > 0 ? slotRes.items[0].value : prev));
    } catch {
      /* 목록 갱신 실패는 화면을 막지 않는다 — 저장은 서버가 다시 검증한다 */
    }
  }, [robotId]);

  useEffect(() => {
    (async () => {
      try {
        const slotRes = await voiceApi.listSlots(robotId);
        setSlots(slotRes.items);
        if (slotRes.items.length > 0) setPreviewDest(slotRes.items[0].value);

        if (intentId !== null) {
          const d = await voiceApi.getIntent(intentId);
          setDisplayName(d.displayName);
          setActionType(d.actionType);
          setIsActive(d.isActive);
          setExamples(d.examples.length ? d.examples : [{ text: "", isKeyword: false }]);
          setResponses(d.responses.length ? d.responses : [{ text: "" }]);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : "불러오지 못했습니다", "error");
      } finally {
        setLoading(false);
        setDirty(false);
      }
    })();
    return () => {
      audioRef.current?.pause();
    };
  }, [robotId, intentId, showToast]);

  const touch = useCallback(() => setDirty(true), []);

  const actionOption = useMemo(
    () => ({ id: actionType, label: ACTION_LABEL[actionType] }),
    [actionType]
  );
  const actionOptions = useMemo(
    () => VOICE_ACTIONS.map((a) => ({ id: a.value, label: `${a.label} — ${a.hint}` })),
    []
  );
  const destOptions = useMemo(
    () => slots.map((s) => ({ id: s.value, label: s.value })),
    [slots]
  );

  /** 커서 자리에 목적지 토큰을 꽂아준다. 편의 버튼일 뿐 — 문장은 자유롭게 쓴다.
   *  질문 버튼은 질문에만, 답변 버튼은 답변에만 넣는다. */
  const insertToken = (kind: "ex" | "rs") => {
    const ref = kind === "ex" ? lastEx : lastRs;
    const list = kind === "ex" ? examples : responses;
    // 그 컬럼에서 만진 적이 없으면 마지막 행 끝에 넣는다(아무 일도 안 일어나는 것보단 낫다)
    const target = ref.current ?? { idx: list.length - 1, pos: list[list.length - 1]?.text.length ?? 0 };
    if (target.idx < 0 || target.idx >= list.length) {
      showToast(kind === "ex" ? "질문을 먼저 추가하세요" : "답변을 먼저 추가하세요", "info");
      return;
    }

    const insertAt = (text: string) => {
      const pos = Math.min(Math.max(target.pos, 0), text.length);
      return text.slice(0, pos) + SLOT_TOKEN + text.slice(pos);
    };

    if (kind === "ex") {
      setExamples((prev) =>
        prev.map((e, i) => (i === target.idx ? { ...e, text: insertAt(e.text) } : e))
      );
    } else {
      setResponses((prev) =>
        prev.map((r, i) => (i === target.idx ? { text: insertAt(r.text) } : r))
      );
    }
    // 다음 삽입이 토큰 뒤에 오도록 커서 위치를 옮겨둔다
    ref.current = { idx: target.idx, pos: target.pos + SLOT_TOKEN.length };
    touch();
  };

  const validate = (): string | null => {
    if (!displayName.trim()) return "시나리오명을 입력하세요";
    const exs = examples.filter((e) => e.text.trim());
    const rss = responses.filter((r) => r.text.trim());
    if (exs.length < VOICE_LIMITS.minExamples)
      return `질문은 ${VOICE_LIMITS.minExamples}개 이상이어야 합니다`;
    if (rss.length < VOICE_LIMITS.minResponses)
      return `답변은 ${VOICE_LIMITS.minResponses}개 이상이어야 합니다`;

    for (const t of [...exs.map((e) => e.text), ...rss.map((r) => r.text)]) {
      const bad = badToken(t);
      if (bad) return `'${bad}' 는 사용할 수 없습니다. 목적지는 '${SLOT_TOKEN}' 하나뿐입니다.`;
    }
    // 안내인데 목적지가 없으면 로봇이 어디로 갈지 알 수 없다
    if (actionType === "navigate" && !exs.some((e) => e.text.includes(SLOT_TOKEN)))
      return `동작이 '안내'인 시나리오는 질문에 ${SLOT_TOKEN} 가 있어야 합니다`;
    return null;
  };

  const save = async () => {
    const err = validate();
    if (err) {
      showToast(err, "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        displayName: displayName.trim(),
        actionType,
        isActive,
        examples: examples
          .filter((e) => e.text.trim())
          .map((e) => ({ text: e.text.trim(), isKeyword: e.isKeyword })),
        responses: responses.filter((r) => r.text.trim()).map((r) => ({ text: r.text.trim() })),
      };
      if (intentId === null) await voiceApi.createIntent(robotId, body);
      else await voiceApi.updateIntent(intentId, body);

      showToast("저장했습니다. 로봇에 반영하려면 [로봇 적용]을 누르세요", "success");
      setDirty(false);
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "저장에 실패했습니다", "error");
    } finally {
      setSaving(false);
    }
  };

  /** 한 문장을 받아와 재생하고, 재생이 끝날 때까지 기다린다.
   *  blob URL 은 '재생이 끝난 뒤'에 해제한다 — 재생 중에 풀면 소리가 끊긴다.
   *  ([전부 듣기]가 다음 문장으로 넘어가며 이전 URL 을 풀어버려 소리가 안 났었다) */
  const playOne = async (idx: number, text: string): Promise<void> => {
    if (!text.trim()) return;
    // 처음 듣는 문장은 로봇이 목소리를 만드는 데 시간이 걸린다(~2.6초).
    setSynthIdx(idx);
    let url: string | null = null;
    try {
      url = await voiceApi.preview(robotId, text, previewDest);
      audioRef.current?.pause();

      const audio = new Audio(url);
      audioRef.current = audio;
      setPreviewBlocked(false);
      setSynthIdx(null);
      setPlayingIdx(idx);

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("오디오 재생 실패"));
        audio.play().catch(reject);
      });
    } catch (e) {
      // 오프라인이면 글자 미리보기는 그대로 두고 재생만 막는다(편집·저장은 정상)
      setPreviewBlocked(true);
      showToast(e instanceof Error ? e.message : "소리를 들을 수 없습니다", "error");
    } finally {
      setSynthIdx(null);
      setPlayingIdx(null);
      if (url) URL.revokeObjectURL(url); // 재생이 끝난 지금 해제한다
    }
  };

  /** 답변별 ▶ — 재생 중인 걸 다시 누르면 멈춘다(토글). */
  const play = (idx: number, text: string) => {
    if (playingIdx === idx) {
      audioRef.current?.pause();
      setPlayingIdx(null);
      return;
    }
    void playOne(idx, text);
  };

  /** [전부 듣기] — 등록된 답변을 하나씩 '재생이 끝날 때까지' 기다려 순차 재생. */
  const playAll = async () => {
    const list = responses.filter((r) => r.text.trim());
    for (let i = 0; i < list.length; i++) {
      await playOne(i, list[i].text);
      if (previewBlocked) break; // 한 번 연결 실패하면 나머지도 안 된다 — 멈춘다
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  /** 로봇에서 실제로 말하고(연결돼 있으면) 이동시킨다. 확인 모달에서만 호출된다. */
  const runRehearse = async () => {
    setRehearseOpen(false);
    setRehearsing(true);
    try {
      const firstResp = responses.find((r) => r.text.trim())?.text ?? "";
      const dest = actionType === "navigate" ? previewDest : null;
      const res = await voiceApi.rehearse(robotId, firstResp, dest, true);

      const said = res.steps.find((s) => s.step === "say");
      const moved = res.steps.find((s) => s.step === "move");
      let msg = said?.ok ? `로봇이 말했습니다: "${said.spoken ?? firstResp}"` : "발화 실패";
      if (moved) msg += moved.ok ? " · 이동 명령을 보냈습니다" : ` · ${moved.msg ?? "이동 안 함"}`;
      showToast(msg, said?.ok ? "success" : "error");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "리허설에 실패했습니다", "error");
    } finally {
      setRehearsing(false);
    }
  };

  const MOTION_LABEL: Record<MotionCmd, string> = {
    sit: "앉아", stand: "일어서", leftTurn: "좌회전", rightTurn: "우회전", stop: "정지",
  };

  /** 동작 명령. immediate=true(정지)면 확인 없이 바로, 아니면 확인 모달을 띄운다. */
  const runMotion = (cmd: MotionCmd, immediate = false) => {
    if (!immediate) {
      setMotionConfirm(cmd);
      return;
    }
    void sendMotion(cmd);
  };

  const sendMotion = async (cmd: MotionCmd) => {
    setMotionConfirm(null);
    setMotionBusy(true);
    try {
      await voiceApi.motion(cmd);
      showToast(`'${MOTION_LABEL[cmd]}' 명령을 보냈습니다`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "동작 명령 실패", "error");
    } finally {
      setMotionBusy(false);
    }
  };

  const close = () => (dirty ? setGuardOpen(true) : onClose());

  if (loading) return <div className={styles.emptyState}>불러오는 중...</div>;

  const exCount = examples.filter((e) => e.text.trim()).length;
  const rsCount = responses.filter((r) => r.text.trim()).length;

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <button className={styles.backBtn} onClick={close}>
          <ArrowLeft size={16} />
        </button>
        <h2>{intentId === null ? "시나리오 추가" : displayName || "시나리오 편집"}</h2>
        <span className={styles.crumb}>음성 관리 / 시나리오 편집</span>
        <div className={styles.grow} />
        {/* 적용 버튼은 여기 없다 — 적용은 시나리오가 아니라 '로봇' 단위다 */}
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={close}>
          취소
        </button>
        <button
          className={`${styles.btn} ${styles.btnPrimary} ${saving ? styles.btnDisabled : ""}`}
          onClick={save}
          disabled={saving}
        >
          저장
        </button>
      </div>

      <div className={styles.formGrid}>
        <div className={styles.formRow}>
          <label>
            시나리오명<span className={styles.req}>*</span>
            <span className={styles.counter}>
              {displayName.length} / {VOICE_LIMITS.displayName}
            </span>
          </label>
          <input
            value={displayName}
            maxLength={VOICE_LIMITS.displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              touch();
            }}
            placeholder="예: 길 안내"
          />
        </div>

        <div className={styles.formRow}>
          <label>동작</label>
          <CustomSelect
            options={actionOptions}
            value={{
              id: actionOption.id,
              label: actionOptions.find((o) => o.id === actionType)?.label ?? "",
            }}
            onChange={(o) => {
              setActionType(o.id as VoiceActionType);
              touch();
            }}
            placeholder="동작 선택"
            className={styles.actionSelect}
          />
          <label className={styles.checkRow}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => {
                setIsActive(e.target.checked);
                touch();
              }}
            />
            <span>활성</span>
          </label>
        </div>
      </div>

      <div className={styles.cols}>
        {/* ── 질문 ── */}
        <section>
          <div className={styles.colHead}>
            <h4>
              질문 (발화 예시)
              <span className={styles.help}>
                ?
                <span className={styles.helpTip}>{QUESTION_HELP}</span>
              </span>
            </h4>
            <span className={styles.cnt}>
              {exCount} / {VOICE_LIMITS.maxExamples}
            </span>
          </div>
          <p className={styles.rule}>
            최소 {VOICE_LIMITS.minExamples}개. 표현이 다양할수록 인식률이 오릅니다.
          </p>

          <div className={styles.rows}>
            {examples.map((ex, idx) => {
              const bad = badToken(ex.text);
              return (
                <div key={idx} className={`${styles.itemRow} ${bad ? styles.itemRowWarn : ""}`}>
                  <span className={styles.idx}>{idx + 1}</span>
                  <input
                    value={ex.text}
                    maxLength={VOICE_LIMITS.exampleText}
                    placeholder="예: {목적지}로 안내해줘"
                    onFocus={(e) =>
                      (lastEx.current = { idx, pos: e.currentTarget.selectionStart ?? ex.text.length })
                    }
                    onSelect={(e) =>
                      (lastEx.current = {
                        idx,
                        pos: e.currentTarget.selectionStart ?? ex.text.length,
                      })
                    }
                    onChange={(e) => {
                      setExamples((p) =>
                        p.map((v, i) => (i === idx ? { ...v, text: e.target.value } : v))
                      );
                      touch();
                    }}
                  />
                  <span className={styles.len}>
                    {ex.text.length} / {VOICE_LIMITS.exampleText}
                  </span>
                  <button
                    className={`${styles.kwToggle} ${ex.isKeyword ? styles.kwOn : ""}`}
                    onClick={() => {
                      setExamples((p) =>
                        p.map((v, i) => (i === idx ? { ...v, isKeyword: !v.isKeyword } : v))
                      );
                      touch();
                    }}
                  >
                    {ex.isKeyword ? "키워드" : "문장"}
                  </button>
                  <button
                    className={styles.iconBtn}
                    onClick={() => {
                      setExamples((p) => p.filter((_, i) => i !== idx));
                      lastEx.current = null; // 인덱스가 밀리므로 기억을 버린다
                      touch();
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {examples.some((e) => badToken(e.text)) && (
            <div className={`${styles.inline} ${styles.inlineWarn}`}>
              중괄호 안에는 <b>목적지</b>만 쓸 수 있습니다. 다른 이름은 인식되지 않습니다.
            </div>
          )}

          {/* 이 시나리오는 사전에 등록된 목적지 전부에 동작한다 — 사전이 비면 아무 데도 못 간다.
              쓰다 말고 다른 탭으로 건너가지 않도록 여기서 바로 열어 준다. */}
          {actionType === "navigate" && (
            <div className={`${styles.inline} ${slots.length === 0 ? styles.inlineWarn : ""}`}>
              {slots.length === 0
                ? "목적지 사전이 비어 있습니다. 목적지를 등록해야 이 시나리오가 동작합니다."
                : `목적지 사전에 ${slots.length}개가 등록되어 있습니다.`}
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setSlotModalOpen(true)}
              >
                목적지 사전 관리
              </button>
            </div>
          )}

          <div className={styles.addRow}>
            <button
              className={styles.addCard}
              disabled={examples.length >= VOICE_LIMITS.maxExamples}
              onClick={() => {
                setExamples((p) => [...p, { text: "", isKeyword: false }]);
                touch();
              }}
            >
              <Plus size={12} />
              {examples.length >= VOICE_LIMITS.maxExamples
                ? `질문 추가 — 최대 ${VOICE_LIMITS.maxExamples}개`
                : "질문 추가"}
            </button>
            <button
              className={styles.insertTok}
              onMouseDown={(e) => e.preventDefault()} // 포커스를 뺏지 않는다(커서 위치 유지)
              onClick={() => insertToken("ex")}
            >
              <Plus size={11} /> 목적지 넣기
            </button>
          </div>
        </section>

        {/* ── 답변 ── */}
        <section>
          <div className={styles.colHead}>
            <h4>답변</h4>
            <span className={styles.cnt}>
              {rsCount} / {VOICE_LIMITS.maxResponses}
            </span>
          </div>
          <p className={styles.rule}>
            최소 {VOICE_LIMITS.minResponses}개. 2개 이상이면 <b>무작위로 골라 말합니다</b>.
          </p>

          <div className={styles.rows}>
            {responses.map((rs, idx) => (
              <div key={idx} className={styles.itemRow}>
                <span className={styles.idx}>{idx + 1}</span>
                <input
                  value={rs.text}
                  maxLength={VOICE_LIMITS.responseText}
                  placeholder="예: {목적지}로 안내하겠습니다."
                  onFocus={(e) =>
                    (lastRs.current = { idx, pos: e.currentTarget.selectionStart ?? rs.text.length })
                  }
                  onSelect={(e) =>
                    (lastRs.current = {
                      idx,
                      pos: e.currentTarget.selectionStart ?? rs.text.length,
                    })
                  }
                  onChange={(e) => {
                    setResponses((p) =>
                      p.map((v, i) => (i === idx ? { text: e.target.value } : v))
                    );
                    touch();
                  }}
                />
                <span className={styles.len}>
                  {rs.text.length} / {VOICE_LIMITS.responseText}
                </span>
                <button
                  className={styles.iconBtn}
                  disabled={previewBlocked}
                  onClick={() => play(idx, rs.text)}
                >
                  {synthIdx === idx ? (
                    <Loader2 size={12} className={styles.spin} />
                  ) : playingIdx === idx ? (
                    <Square size={11} />
                  ) : (
                    <Play size={11} />
                  )}
                </button>
                <button
                  className={styles.iconBtn}
                  onClick={() => {
                    setResponses((p) => p.filter((_, i) => i !== idx));
                    lastRs.current = null;
                    touch();
                  }}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>

          <div className={styles.addRow}>
            <button
              className={styles.addCard}
              disabled={responses.length >= VOICE_LIMITS.maxResponses}
              onClick={() => {
                setResponses((p) => [...p, { text: "" }]);
                touch();
              }}
            >
              <Plus size={12} />
              {responses.length >= VOICE_LIMITS.maxResponses
                ? `답변 추가 — 최대 ${VOICE_LIMITS.maxResponses}개`
                : "답변 추가"}
            </button>
            <button
              className={styles.insertTok}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertToken("rs")}
            >
              <Plus size={11} /> 목적지 넣기
            </button>
          </div>

          {/* 미리듣기 — 목적지를 골라야 무엇을 들려줄지 정해진다 */}
          <div className={styles.preview}>
            <div className={styles.previewHead}>
              <span className={styles.previewTitle}>로봇이 실제로 말할 문장</span>
              <div className={styles.grow} />
              {actionType === "navigate" && destOptions.length > 0 && (
                <CustomSelect
                  options={destOptions}
                  value={previewDest ? { id: previewDest, label: previewDest } : null}
                  onChange={(o) => setPreviewDest(String(o.id))}
                  placeholder="목적지"
                  width={170}
                  className={styles.destSelect}
                />
              )}
              <button
                className={styles.playAll}
                onClick={playAll}
                disabled={previewBlocked || rsCount === 0}
              >
                <Play size={10} /> 전부 듣기
              </button>
            </div>
            <p className={styles.hint}>
              {previewBlocked ? (
                <>
                  <b>로봇에 연결되어 있지 않아 소리를 들을 수 없습니다.</b> 글자로는 확인할 수
                  있고, 편집·저장은 정상 동작합니다.
                </>
              ) : (
                <>
                  <b>[전부 듣기]</b>는 등록된 답변을 차례로 들려줍니다 — 실제로는 이 중{" "}
                  <b>하나를 무작위로</b> 말합니다. 목적지에 따라 조사와 숫자 읽는 법이 바뀝니다
                  (10층은 &quot;십층&quot;).
                </>
              )}
            </p>

            {/* 리허설 — 로봇 스피커로 실제 발화 + (연결돼 있으면) 실제 이동.
                ⚠ 로봇을 움직이므로 확인 모달을 반드시 거친다. */}
            {responses.some((r) => r.text.trim()) && (
              <div className={styles.rehearseRow}>
                <button
                  className={styles.rehearseBtn}
                  disabled={rehearsing}
                  onClick={() => setRehearseOpen(true)}
                >
                  {rehearsing ? (
                    <Loader2 size={13} className={styles.spin} />
                  ) : (
                    <Play size={11} />
                  )}
                  로봇에서 음성 안내 후 이동
                </button>
                <span className={styles.rehearseNote}>
                  로봇 스피커로 실제로 말합니다
                  {actionType === "navigate" ? " · 목적지가 연결돼 있으면 실제로 이동합니다" : ""}
                </span>
              </div>
            )}

            {/* 동작 테스트 — 시나리오와 무관. 관제→로봇 동작 통로 검증용(사족보행).
                ⚠ 로봇이 실제로 움직인다. [정지]가 항상 붙어 있어 언제든 멈춘다. */}
            <div className={styles.motionRow}>
              <span className={styles.motionLabel}>동작 테스트</span>
              <button className={styles.motionBtn} disabled={motionBusy} onClick={() => runMotion("sit")}>
                앉아
              </button>
              <button className={styles.motionBtn} disabled={motionBusy} onClick={() => runMotion("stand")}>
                일어서
              </button>
              <button className={styles.motionBtn} disabled={motionBusy} onClick={() => runMotion("leftTurn")}>
                ◀ 좌회전
              </button>
              <button className={styles.motionBtn} disabled={motionBusy} onClick={() => runMotion("rightTurn")}>
                우회전 ▶
              </button>
              {/* 회전은 계속 돌 수 있다 — 정지는 확인 없이 즉시(항상 활성) */}
              <button className={`${styles.motionBtn} ${styles.motionStop}`} onClick={() => runMotion("stop", true)}>
                ■ 정지
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* 리허설 확인 — 로봇이 실제로 움직인다. 반드시 사람이 확인하고 누른다. */}
      {rehearseOpen && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox}>
            <div className={styles.confirmText}>로봇에서 실제로 실행할까요?</div>
            <div className={`${styles.inline} ${styles.inlineWarn}`} style={{ textAlign: "left" }}>
              로봇 스피커로 <b>실제로 소리가 납니다.</b>
              {actionType === "navigate" && previewDest && (
                <>
                  <br />
                  목적지 <b>{previewDest}</b>가 장소에 연결돼 있으면 <b>로봇이 그곳으로 이동</b>합니다.
                  <br />
                  <b>로봇 주변에 사람이 없는지 확인하세요.</b>
                </>
              )}
            </div>
            <div className={styles.confirmBtns}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setRehearseOpen(false)}
              >
                취소
              </button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={runRehearse}>
                실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 동작 확인 — 로봇이 실제로 움직인다(회전은 계속 돌 수 있음) */}
      {motionConfirm && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox}>
            <div className={styles.confirmText}>
              로봇에게 <b>{MOTION_LABEL[motionConfirm]}</b> 명령을 보낼까요?
            </div>
            <div className={`${styles.inline} ${styles.inlineWarn}`} style={{ textAlign: "left" }}>
              <b>로봇이 실제로 움직입니다.</b> 주변에 사람이 없는지 확인하세요.
              {(motionConfirm === "leftTurn" || motionConfirm === "rightTurn") && (
                <>
                  <br />
                  회전은 계속될 수 있습니다 — <b>[정지]</b>로 멈추세요.
                </>
              )}
            </div>
            <div className={styles.confirmBtns}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setMotionConfirm(null)}
              >
                취소
              </button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => sendMotion(motionConfirm)}
              >
                실행
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이탈 가드 — 무엇이 사라지는지 명시한다 */}
      {guardOpen && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox}>
            <div className={styles.confirmText}>
              <b>{displayName || "이 시나리오"}</b>의 변경 내용을 저장할까요?
            </div>
            <p className={styles.confirmSub}>저장하지 않으면 편집한 내용이 사라집니다.</p>
            <div className={styles.confirmBtns}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setGuardOpen(false)}
              >
                취소
              </button>
              <button className={`${styles.btn} ${styles.btnNeutral}`} onClick={onClose}>
                저장 안 함
              </button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => {
                  setGuardOpen(false);
                  save();
                }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목적지 사전 — 닫으면 목록을 다시 불러 방금 등록한 목적지가 바로 반영된다 */}
      {slotModalOpen && (
        <VoiceSlotModal
          robotId={robotId}
          onClose={() => setSlotModalOpen(false)}
          onChanged={reloadSlots}
        />
      )}
    </div>
  );
}
