"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/app/components/common/Toast";
import CustomSelect from "@/app/components/select/CustomSelect";
import { VOICE_LIMITS } from "@/app/constants/voice";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./voice.module.css";
import { voiceApi, type SlotConflict, type VoicePlace, type VoiceSlot } from "./voiceApi";

type Props = {
  robotId: number;
  onClose: () => void;
  onChanged: () => void;
};

type FormState = {
  id: number | null;
  value: string;
  synonyms: string;
  locationId: number | null;
  originalValue: string;
  keepOldName: boolean;
};

const EMPTY: FormState = {
  id: null,
  value: "",
  synonyms: "",
  locationId: null,
  originalValue: "",
  keepOldName: true,
};

export default function VoiceSlotModal({ robotId, onClose, onChanged }: Props) {
  const { showToast } = useToast();

  const [slots, setSlots] = useState<VoiceSlot[]>([]);
  const [places, setPlaces] = useState<VoicePlace[]>([]);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [conflict, setConflict] = useState<SlotConflict | null>(null);
  const [formError, setFormError] = useState<string | null>(null); // 중복 등 저장 거부 사유(인라인)
  const [deleteTarget, setDeleteTarget] = useState<VoiceSlot | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await voiceApi.listSlots(robotId);
      setSlots(res.items);
      setPlaces(res.places);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "불러오지 못했습니다", "error");
    }
  }, [robotId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // 뷰가 바뀌거나 다른 목적지를 열면 이전 저장 에러를 지운다
  useEffect(() => {
    setFormError(null);
  }, [view, form.id]);

  const placeOptions = useMemo(
    () => [
      { id: 0, label: "연결 안 함 — 음성 안내만 하고 움직이지 않음" },
      ...places.map((p) => ({ id: p.id, label: p.name })),
    ],
    [places]
  );

  const submit = async (force = false) => {
    const value = form.value.trim();
    if (!value) {
      showToast("목적지를 입력하세요", "error");
      return;
    }
    const body = {
      value,
      synonyms: form.synonyms.trim() || null,
      locationId: form.locationId || null,
      // 이름을 바꾸면 사람들은 여전히 예전 이름으로 부르는데 로봇만 못 알아듣는다
      keepOldNameAsSynonym: form.keepOldName && form.id !== null && form.originalValue !== value,
    };
    try {
      const res =
        form.id === null
          ? await voiceApi.createSlot(robotId, body, force)
          : await voiceApi.updateSlot(form.id, body, force);

      if (res.status === "conflict" && res.conflict) {
        setConflict(res.conflict); // 유사 이름 — 확인 후 등록
        return;
      }
      showToast("저장했습니다", "success");
      setView("list");
      setForm(EMPTY);
      setConflict(null);
      setFormError(null);
      await load();
      onChanged();
    } catch (e) {
      // 중복(이미 있는 목적지)·0.90 이상 유사 등은 서버가 409로 막는다 — 토스트 + 인라인 둘 다
      const msg = e instanceof Error ? e.message : "저장에 실패했습니다";
      setFormError(msg);
      showToast(msg, "error");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await voiceApi.deleteSlot(deleteTarget.id);
      showToast(`'${deleteTarget.value}' 목적지를 삭제했습니다`, "success");
      setDeleteTarget(null);
      // 삭제한 항목의 편집 폼에 머물지 않고 목록으로 돌아간다
      setView("list");
      setForm(EMPTY);
      setConflict(null);
      await load();
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "삭제에 실패했습니다", "error");
    }
  };

  const nameChanged = form.id !== null && form.originalValue !== form.value.trim();

  return (
    // 오버레이 클릭으로 닫지 않는다 — 텍스트 드래그 선택이 오버레이에서 끝나면 닫히기 때문
    <div className={modalStyles.modalOverlay}>
      <div className={modalStyles.detailModalContent}>
        <div className={modalStyles.detailHeader}>
          <div className={modalStyles.detailHeaderTop}>
            <h2>{view === "list" ? "목적지 사전" : form.id === null ? "목적지 추가" : "목적지 편집"}</h2>
            <button className={modalStyles.detailCloseBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={modalStyles.detailBody}>
          {view === "list" ? (
            <>
              <div className={styles.slotBar}>
                <span className={styles.totalCount}>
                  총 <span>{slots.length}</span> 개 · 연결됨{" "}
                  <span>{slots.filter((s) => s.locationId).length}</span>
                </span>
                <div className={styles.grow} />
                <button
                  className={styles.workBtn}
                  onClick={() => {
                    setForm(EMPTY);
                    setConflict(null);
                    setView("form");
                  }}
                >
                  목적지 추가
                </button>
              </div>

              <div className={styles.slotScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.thLeft} style={{ width: 160 }}>목적지</th>
                      <th className={styles.thLeft}>동의어</th>
                      <th style={{ width: 170 }}>연결된 장소</th>
                      <th style={{ width: 88 }}>편집</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <div className={styles.emptyState}>등록된 목적지가 없습니다.</div>
                        </td>
                      </tr>
                    ) : (
                      slots.map((s) => (
                        <tr
                          key={s.id}
                          className={styles.rowClickable}
                          onClick={() => {
                            setForm({
                              id: s.id,
                              value: s.value,
                              synonyms: s.synonyms,
                              locationId: s.locationId,
                              originalValue: s.value,
                              keepOldName: true,
                            });
                            setConflict(null);
                            setView("form");
                          }}
                        >
                          <td className={styles.tdLeft}>
                            <span className={styles.nameCell}>{s.value}</span>
                          </td>
                          <td
                            className={styles.tdLeft}
                            style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 }}
                            title={s.synonyms || undefined}
                          >
                            {s.synonyms || "-"}
                          </td>
                          <td>
                            <span
                              className={`${styles.badge} ${
                                s.locationId ? styles.badgeOn : styles.badgeOff
                              }`}
                            >
                              {s.locationName ?? "미연결"}
                            </span>
                          </td>
                          <td className={styles.tdAction}>
                            <button
                              className={styles.detailButton}
                              onClick={() => {
                                setForm({
                                  id: s.id,
                                  value: s.value,
                                  synonyms: s.synonyms,
                                  locationId: s.locationId,
                                  originalValue: s.value,
                                  keepOldName: true,
                                });
                                setConflict(null);
                                setView("form");
                              }}
                            >
                              편집
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <p className={styles.hint}>
                <b>연결된 장소</b>가 있어야 음성 명령이 <b>실제 이동</b>으로 이어집니다. 비워두면
                음성 안내만 합니다.
              </p>
            </>
          ) : (
            <div className={styles.formGridFull}>
              <div className={styles.formRow}>
                <label>
                  목적지<span className={styles.req}>*</span>
                </label>
                <input
                  className={formError ? styles.inputError : undefined}
                  value={form.value}
                  maxLength={50}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, value: e.target.value }));
                    setConflict(null);
                    setFormError(null);
                  }}
                  placeholder="예: 응급실"
                />
                {formError && <p className={styles.fieldError}>{formError}</p>}
              </div>

              {/* 이름을 바꾸면 예전 이름으로 부르는 사람을 못 알아듣는다 */}
              {nameChanged && (
                <div className={`${styles.inline} ${styles.inlineWarn}`}>
                  이름을 바꾸면 로봇은 예전 이름 <b>&quot;{form.originalValue}&quot;</b>을 못
                  알아듣습니다. 사람들은 여전히 그렇게 부를 텐데요.
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={form.keepOldName}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, keepOldName: e.target.checked }))
                      }
                    />
                    <span>
                      <b>&quot;{form.originalValue}&quot;을 동의어로 남기기</b> (권장)
                    </span>
                  </label>
                </div>
              )}

              {conflict && (
                <div className={`${styles.inline} ${styles.inlineWarn}`}>
                  기존 {conflict.kind} <b>&quot;{conflict.against}&quot;</b>와{" "}
                  <b>{Math.round(conflict.score * 100)}% 유사</b>합니다. 음성 인식이 살짝 틀리면
                  엉뚱한 곳으로 이동할 수 있습니다.
                  <div className={styles.inlineActs}>
                    <button className={styles.workBtn} onClick={() => submit(true)}>
                      그래도 등록
                    </button>
                    <button
                      className={`${styles.workBtn} ${styles.ghost}`}
                      onClick={() => setConflict(null)}
                    >
                      이름 변경
                    </button>
                  </div>
                </div>
              )}

              <div className={styles.formRow}>
                <label>동의어 (쉼표로 구분)</label>
                <input
                  value={form.synonyms}
                  maxLength={VOICE_LIMITS.synonyms}
                  onChange={(e) => setForm((f) => ({ ...f, synonyms: e.target.value }))}
                  placeholder="예: 응급센터, 이머전시"
                />
                <p className={styles.hint}>다르게 받아써도 같은 목적지로 인식됩니다.</p>
              </div>

              <div className={styles.formRow}>
                <label>연결 장소 (선택)</label>
                <CustomSelect
                  options={placeOptions}
                  value={
                    placeOptions.find((o) => o.id === (form.locationId ?? 0)) ?? placeOptions[0]
                  }
                  onChange={(o) =>
                    setForm((f) => ({ ...f, locationId: Number(o.id) || null }))
                  }
                  placeholder="장소 선택"
                  overlay
                />
                <p className={styles.hint}>
                  맵 관리 › 장소 목록에 등록된 지점을 그대로 가져옵니다. 이 로봇의 현재 맵에 있는
                  장소만 보입니다.
                </p>
              </div>
            </div>
          )}
        </div>

        {view === "form" && (
          <div className={`${modalStyles.detailFooter} ${styles.footSplit}`}>
            {form.id !== null ? (
              <button
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() =>
                  setDeleteTarget(slots.find((s) => s.id === form.id) ?? null)
                }
              >
                삭제
              </button>
            ) : (
              <span />
            )}
            <div className={styles.footRight}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => {
                  setView("list");
                  setConflict(null);
                }}
              >
                취소
              </button>
              <button
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => submit(false)}
              >
                저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 삭제하면 로봇이 그 말을 못 알아듣게 된다 — 무엇이 사라지는지 말해준다 */}
      {deleteTarget && (
        <div className={styles.confirmOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.confirmBox}>
            <div className={styles.confirmText}>
              목적지 <b>&quot;{deleteTarget.value}&quot;</b>을 삭제할까요?
            </div>
            <p className={styles.confirmSub}>
              로봇이 &quot;{deleteTarget.value}&quot;
              {deleteTarget.synonyms ? `와 동의어 "${deleteTarget.synonyms}"` : ""}를 더 이상
              알아듣지 못합니다.
              <br />
              안내 시나리오 자체는 그대로 남고, 다른 목적지는 정상 동작합니다.
            </p>
            <div className={styles.confirmBtns}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setDeleteTarget(null)}
              >
                취소
              </button>
              <button className={`${styles.btn} ${styles.btnDanger}`} onClick={remove}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
