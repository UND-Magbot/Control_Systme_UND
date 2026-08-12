"use client";

/**
 * 음성 인식어 관리 (종류별).
 *
 *   arrival — 경유지 도착에서 확인 방식이 '음성'일 때 **통과로 볼 말**
 *   dismiss — 안내를 마치고 **돌아가도 되는지** 판단할 말
 *
 * 둘을 한 화면에서 다루되 목록은 섞지 않는다 — '없음' 이 도착 확인을 통과시키거나
 * '이동' 이 로봇을 돌려보내면 곤란하다.
 * 코드에 박아 두면 볼 수도 고칠 수도 없고, 안내 멘트가 유도하는 말과 어긋나도
 * 알 방법이 없다(실제로 '이동하자'로 어긋났다).
 *
 * 판정은 서버 단일 출처다 — 이 화면은 목록을 보여주고 고칠 뿐이다.
 * '출처'는 서버가 함께 내려주는 defaults 와 대조해 화면에서 판단한다(스키마를 늘리지 않는다).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/app/components/common/Toast";
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./voice.module.css";
import { voiceApi, type ConfirmWordKind, type VoiceConfirmWord } from "./voiceApi";

type Props = {
  robotId: number;
  kind?: ConfirmWordKind;
  onClose: () => void;
  /** 목록이 바뀌면 부모(설정 화면 등)가 미리보기를 갱신할 수 있게 알린다 */
  onChanged?: () => void;
};

const MAX_LEN = 30;

const COPY: Record<ConfirmWordKind, {
  title: string; help: React.ReactNode; placeholder: string;
}> = {
  arrival: {
    title: "도착 확인 인식어",
    placeholder: "예: 출발합시다",
    help: (
      <>들은 말에 이 단어가 <b>포함</b>되면 경유지를 통과합니다 — &apos;이동&apos; 하나면 &apos;이동해줘&apos;도 걸립니다.</>
    ),
  },
  dismiss: {
    title: "안내 종료 인식어",
    placeholder: "예: 이제 됐어요",
    help: (
      <>목적지에 데려다준 뒤 이 말을 들으면 <b>대기 장소로 돌아갑니다</b>. 아무 말이 없으면 60초 뒤 자동 복귀합니다.</>
    ),
  },
};

export default function VoiceConfirmWordModal({ robotId, kind = "arrival", onClose, onChanged }: Props) {
  const copy = COPY[kind];
  const { showToast } = useToast();

  const [items, setItems] = useState<VoiceConfirmWord[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [usingDefaults, setUsingDefaults] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [newWord, setNewWord] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editWord, setEditWord] = useState("");
  const [seededNotice, setSeededNotice] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await voiceApi.listConfirmWords(robotId, kind);
      setItems(r.items);
      setDefaults(r.defaults);
      setUsingDefaults(r.usingDefaults);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "불러오지 못했습니다", "error");
    } finally {
      setLoading(false);
    }
  }, [robotId, kind, showToast]);

  useEffect(() => { load(); }, [load]);

  // 목록이 길어지면(기본만 14개 + 추가분) 모달이 통째로 늘어난다 → 표 안에서 스크롤.
  // 네이티브 대신 다른 화면과 같은 커스텀 스크롤바를 쓴다.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listTrackRef = useRef<HTMLDivElement>(null);
  const listThumbRef = useRef<HTMLDivElement>(null);

  useCustomScrollbar({
    enabled: !usingDefaults && !loading,
    scrollRef: listScrollRef,
    trackRef: listTrackRef,
    thumbRef: listThumbRef,
    minThumbHeight: 36,
    deps: [items.length, editingId],
  });

  const defaultSet = useMemo(() => new Set(defaults), [defaults]);
  const activeCount = items.filter((w) => w.isActive).length;

  const done = async (msg: string) => {
    await load();
    onChanged?.();
    showToast(msg, "success");
  };

  const add = async () => {
    const word = newWord.trim();
    if (!word) return;
    if (word.length > MAX_LEN) { showToast(`인식어는 ${MAX_LEN}자를 넘을 수 없습니다`, "error"); return; }
    setBusy(true);
    try {
      const r = await voiceApi.createConfirmWord(robotId, { word }, kind);
      setNewWord("");
      // 첫 등록이면 서버가 기본 목록을 함께 깔았다 — 그 사실을 반드시 알린다.
      // 모르면 "추가만 했는데 왜 목록이 15개지?" 가 된다.
      if (r.seeded > 0) setSeededNotice(r.seeded);
      await done(r.seeded > 0 ? `기본 ${r.seeded}개와 함께 등록했습니다` : `'${word}' 를 등록했습니다`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "등록하지 못했습니다", "error");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (w: VoiceConfirmWord) => {
    const word = editWord.trim();
    if (!word || word === w.word) { setEditingId(null); return; }
    setBusy(true);
    try {
      await voiceApi.updateConfirmWord(w.id, { word, isActive: w.isActive, sortOrder: w.sortOrder });
      setEditingId(null);
      await done("수정했습니다");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "수정하지 못했습니다", "error");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (w: VoiceConfirmWord) => {
    setBusy(true);
    try {
      await voiceApi.updateConfirmWord(w.id, { word: w.word, isActive: !w.isActive, sortOrder: w.sortOrder });
      await done(!w.isActive ? `'${w.word}' 를 사용합니다` : `'${w.word}' 를 끄었습니다`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "변경하지 못했습니다", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w: VoiceConfirmWord) => {
    setBusy(true);
    try {
      await voiceApi.deleteConfirmWord(w.id);
      await done(`'${w.word}' 를 삭제했습니다`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "삭제하지 못했습니다", "error");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const r = await voiceApi.resetConfirmWords(robotId, kind);
      setSeededNotice(0);
      await done(`기본 ${r.count}개로 되돌렸습니다`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "초기화하지 못했습니다", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={modalStyles.modalOverlay} onClick={onClose}>
      <div className={styles.confirmWordModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.cwHead}>
          <span className={styles.cwTitle}>{copy.title}</span>
          <button className={styles.cwClose} onClick={onClose} aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        <div className={styles.cwBody}>
          {/* 등록이 없으면 기본으로 돈다 — 화면이 말해주지 않으면
              "인식어가 없다 = 확인이 안 된다" 로 오해한다 */}
          {usingDefaults ? (
            <div className={`${styles.cwBanner} ${styles.cwBannerInfo}`}>
              지금은 <b>기본 인식어 {defaults.length}개</b>로 동작합니다.
              하나라도 등록하면 기본 목록이 함께 저장되고, 그다음부터는 <b>등록한 목록만</b> 쓰입니다.
            </div>
          ) : seededNotice > 0 ? (
            <div className={`${styles.cwBanner} ${styles.cwBannerOk}`}>
              <b>기본 인식어 {seededNotice}개를 함께 등록했습니다.</b>
              {" "}이제 이 목록만 판정에 쓰입니다 — 필요 없는 말은 끄거나 지우세요.
            </div>
          ) : null}

          {loading ? (
            <div className={styles.cwEmpty}>불러오는 중…</div>
          ) : usingDefaults ? (
            <div>
              <div className={styles.cwLabel}>기본 인식어</div>
              <div className={styles.cwChips}>
                {defaults.map((w) => (
                  <span key={w} className={styles.cwChip}>{w}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.cwTableArea}>
              <div ref={listScrollRef} className={styles.cwTableWrap}>
              <table className={styles.cwTable}>
                <thead>
                  <tr>
                    <th>인식어</th>
                    <th style={{ width: 96 }}>출처</th>
                    <th style={{ width: 72 }}>사용</th>
                    <th style={{ width: 100 }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((w) => (
                    <tr key={w.id}>
                      <td>
                        {editingId === w.id ? (
                          <input
                            className={styles.cwInput}
                            value={editWord}
                            autoFocus
                            maxLength={MAX_LEN}
                            onChange={(e) => setEditWord(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(w);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            onBlur={() => saveEdit(w)}
                          />
                        ) : (
                          <span className={styles.cwWord}>{w.word}</span>
                        )}
                      </td>
                      <td>
                        <span className={defaultSet.has(w.word) ? styles.cwOrigin : styles.cwOriginCustom}>
                          {defaultSet.has(w.word) ? "기본" : "직접 추가"}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`${styles.cwToggle} ${w.isActive ? "" : styles.cwToggleOff}`}
                          disabled={busy}
                          onClick={() => toggle(w)}
                          aria-label={w.isActive ? "사용 중 — 끄기" : "꺼짐 — 사용하기"}
                        />
                      </td>
                      <td className={styles.cwRowAct}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => { setEditingId(w.id); setEditWord(w.word); }}
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          className={styles.cwDel}
                          disabled={busy}
                          onClick={() => remove(w)}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              <div ref={listTrackRef} className={styles.cwScrollTrack}>
                <div ref={listThumbRef} className={styles.cwScrollThumb} />
              </div>
            </div>
          )}

          <div>
            <div className={styles.cwLabel}>인식어 추가</div>
            <div className={styles.cwAddRow}>
              <input
                className={styles.cwInput}
                placeholder={copy.placeholder}
                value={newWord}
                maxLength={MAX_LEN}
                disabled={busy}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              />
              <button
                type="button"
                className={styles.cwBtnPrimary}
                disabled={busy || !newWord.trim()}
                onClick={add}
              >
                추가
              </button>
            </div>
            <div className={styles.cwHelp}>{copy.help}</div>
          </div>
        </div>

        <div className={styles.cwFoot}>
          <button
            type="button"
            className={styles.cwBtnQuiet}
            disabled={busy || usingDefaults}
            onClick={reset}
          >
            기본값으로 초기화
          </button>
          {!usingDefaults && (
            <span className={styles.cwCount}>
              사용 {activeCount}개
              {items.length - activeCount > 0 && ` · 꺼짐 ${items.length - activeCount}개`}
            </span>
          )}
          <button type="button" className={styles.cwBtnGhost} onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
