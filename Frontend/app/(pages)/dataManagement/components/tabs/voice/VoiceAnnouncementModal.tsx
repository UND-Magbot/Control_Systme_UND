"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/app/components/common/Toast";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./voice.module.css";
import { voiceApi, type VoiceAnnouncement } from "./voiceApi";

type Props = {
  robotId: number;
  robotName: string;
  onClose: () => void;
  onChanged: () => void;
};

const MAX_TEXT = 200;
const MAX_LABEL = 40;

type FormState = {
  id: number | null;
  text: string;
  label: string;
  isActive: boolean;
};

const EMPTY: FormState = { id: null, text: "", label: "", isActive: true };

/**
 * 안내 멘트 — 경유지 도착 시 로봇이 말할 순수 발화 문구 (로봇별).
 * 시나리오(질문→답변)와 달리 질문·매칭이 없다. 경로 정지 옵션이 이 문구를 참조한다.
 */
export default function VoiceAnnouncementModal({ robotId, robotName, onClose, onChanged }: Props) {
  const { showToast } = useToast();

  const [items, setItems] = useState<VoiceAnnouncement[]>([]);
  const [view, setView] = useState<"list" | "form">("list");
  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoiceAnnouncement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await voiceApi.listAnnouncements(robotId);
      setItems(res.items);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "불러오지 못했습니다", "error");
    }
  }, [robotId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setFormError(null);
  }, [view, form.id]);

  const submit = async () => {
    const label = form.label.trim();
    const text = form.text.trim();
    if (!label) {
      setFormError("발화명을 입력하세요");
      showToast("발화명을 입력하세요", "error");
      return;
    }
    if (!text) {
      setFormError("발화 문구를 입력하세요");
      showToast("발화 문구를 입력하세요", "error");
      return;
    }
    const body = { text, label, isActive: form.isActive };
    try {
      if (form.id === null) await voiceApi.createAnnouncement(robotId, body);
      else await voiceApi.updateAnnouncement(form.id, body);
      showToast("저장했습니다", "success");
      setView("list");
      setForm(EMPTY);
      setFormError(null);
      await load();
      onChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "저장에 실패했습니다";
      setFormError(msg);
      showToast(msg, "error");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await voiceApi.deleteAnnouncement(deleteTarget.id);
      showToast("안내 멘트를 삭제했습니다", "success");
      setDeleteTarget(null);
      setView("list");
      setForm(EMPTY);
      await load();
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "삭제에 실패했습니다", "error");
    }
  };

  const openForm = (a: VoiceAnnouncement | null) => {
    setForm(a ? { id: a.id, text: a.text, label: a.label, isActive: a.isActive } : EMPTY);
    setView("form");
  };

  // 서버/클라이언트 오류 메시지를 관련 필드 아래로 보낸다 (발화명 vs 발화 문구)
  const labelError = !!formError && formError.includes("발화명");
  const textError = !!formError && !labelError;

  return (
    // 오버레이 클릭으로 닫지 않는다 — 텍스트 드래그가 오버레이에서 끝나면 닫히기 때문
    <div className={modalStyles.modalOverlay}>
      <div className={modalStyles.detailModalContent}>
        <div className={modalStyles.detailHeader}>
          <div className={modalStyles.detailHeaderTop}>
            <h2>
              {view === "list"
                ? `안내 멘트 · ${robotName}`
                : form.id === null
                ? "안내 멘트 추가"
                : "안내 멘트 편집"}
            </h2>
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
                  총 <span>{items.length}</span> 개
                </span>
                <div className={styles.grow} />
                <button className={styles.workBtn} onClick={() => openForm(null)}>
                  멘트 추가
                </button>
              </div>

              <div className={styles.slotScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.thLeft} style={{ width: 150 }}>발화명</th>
                      <th className={styles.thLeft}>발화 문구</th>
                      <th style={{ width: 90 }}>사용</th>
                      <th style={{ width: 88 }}>편집</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <div className={styles.emptyState}>등록된 안내 멘트가 없습니다.</div>
                        </td>
                      </tr>
                    ) : (
                      items.map((a) => (
                        <tr key={a.id} className={styles.rowClickable} onClick={() => openForm(a)}>
                          <td className={styles.tdLeft}>
                            <span className={styles.nameCell}>{a.label}</span>
                          </td>
                          <td
                            className={styles.tdLeft}
                            style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 }}
                            title={a.text}
                          >
                            {a.text}
                          </td>
                          <td>
                            <span
                              className={`${styles.badge} ${a.isActive ? styles.badgeOn : styles.badgeOff}`}
                            >
                              {a.isActive ? "사용" : "끔"}
                            </span>
                          </td>
                          <td className={styles.tdAction}>
                            <button
                              className={styles.detailButton}
                              onClick={(e) => {
                                e.stopPropagation();
                                openForm(a);
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
                경로 경유지의 <b>도착 발화</b>로 여기서 선택합니다. 로봇이 도착 시 이 문구를 그대로
                말합니다.
              </p>
            </>
          ) : (
            <div className={styles.formGridFull}>
              <div className={styles.formRow}>
                <label>
                  발화명<span className={styles.req}>*</span>
                </label>
                <input
                  className={labelError ? styles.inputError : undefined}
                  value={form.label}
                  maxLength={MAX_LABEL}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, label: e.target.value }));
                    setFormError(null);
                  }}
                  placeholder="예: 적재 요청"
                />
                {labelError && <p className={styles.fieldError}>{formError}</p>}
                <p className={styles.hint}>정지 옵션 드롭다운에 이 이름으로 표시됩니다. 로봇 내에서 겹칠 수 없습니다.</p>
              </div>

              <div className={styles.formRow}>
                <label>
                  발화 문구<span className={styles.req}>*</span>
                </label>
                <textarea
                  className={textError ? styles.inputError : undefined}
                  value={form.text}
                  maxLength={MAX_TEXT}
                  rows={2}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, text: e.target.value }));
                    setFormError(null);
                  }}
                  placeholder="예: 물건을 실어 주세요"
                />
                {textError && <p className={styles.fieldError}>{formError}</p>}
                <p className={styles.hint}>로봇이 도착 시 실제로 말하는 문구입니다.</p>
              </div>

              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                <span>사용</span>
              </label>
            </div>
          )}
        </div>

        {view === "form" && (
          <div className={`${modalStyles.detailFooter} ${styles.footSplit}`}>
            {form.id !== null ? (
              <button
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => setDeleteTarget(items.find((a) => a.id === form.id) ?? null)}
              >
                삭제
              </button>
            ) : (
              <span />
            )}
            <div className={styles.footRight}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setView("list")}
              >
                취소
              </button>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={submit}>
                저장
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 삭제하면 이 멘트를 쓰던 경유지는 발화 없음으로 처리된다 */}
      {deleteTarget && (
        <div className={styles.confirmOverlay} onClick={(e) => e.stopPropagation()}>
          <div className={styles.confirmBox}>
            <div className={styles.confirmText}>이 안내 멘트를 삭제할까요?</div>
            <p className={styles.confirmSub}>
              &quot;{deleteTarget.text}&quot;
              <br />이 멘트를 쓰던 경유지는 <b>발화 없이 확인만</b> 진행됩니다. (이미 적용된 로봇은
              [로봇 적용] 재실행 전까지 마지막 문구가 나갑니다.)
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
