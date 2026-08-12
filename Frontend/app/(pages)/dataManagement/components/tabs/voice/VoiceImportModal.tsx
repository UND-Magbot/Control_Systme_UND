"use client";

import React, { useRef, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/app/components/common/Toast";
import { SLOT_TOKEN, VOICE_LIMITS } from "@/app/constants/voice";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./voice.module.css";
import { voiceApi, type ImportError, type ImportSummary } from "./voiceApi";

type Props = {
  robotId: number;
  robotName: string;
  onClose: () => void;
  onImported: () => void;
};

/**
 * CSV 일괄 등록.
 *
 * - 전량 거부(all-or-nothing): 1행이라도 검증에 걸리면 아무것도 등록하지 않는다.
 *   "9건은 들어가고 3건은 안 들어간" 상태로 로봇에 적용하면 반쪽짜리 지식으로 말한다.
 * - 병합(upsert): 시나리오명이 키. 파일에서 행을 지워도 삭제되지 않는다.
 */
const ALLOWED_EXT = /\.(xlsx|xls|csv)$/i;

export default function VoiceImportModal({ robotId, robotName, onClose, onImported }: Props) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<ImportError[] | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);

  // 파일 하나를 받아 검증까지. 확장자·중복처리를 여기서 한 번에 거른다.
  const pick = (f: File | null | undefined) => {
    if (busy) return; // 검증 중 재드롭 무시 — 중복 처리 방지
    if (!f) return;
    if (!ALLOWED_EXT.test(f.name)) {
      showToast("xlsx 또는 csv 파일만 올릴 수 있습니다", "error");
      return;
    }
    validate(f);
  };

  const validate = async (f: File) => {
    setBusy(true);
    setErrors(null);
    setSummary(null);
    try {
      const csv = await voiceApi.toCsvFile(f); // xlsx 면 브라우저에서 CSV 로 변환
      setFile(csv);
      const res = await voiceApi.importCsv(robotId, csv, true); // dryRun — 쓰지 않는다
      setErrors(res.errors);
      setSummary(res.summary);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "검증에 실패했습니다", "error");
      // 실패한 파일을 남기면 "파일은 올라갔는데 아무 반응 없는" 상태로 멈춘다 — 초기화한다
      setFile(null);
      setErrors(null);
      setSummary(null);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await voiceApi.importCsv(robotId, file, false);
      if (res.status !== "ok") {
        setErrors(res.errors);
        return;
      }
      showToast(
        `${res.summary.created + res.summary.updated}건 등록했습니다. 로봇에 반영하려면 [로봇 적용]을 누르세요`,
        "success"
      );
      onImported();
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "등록에 실패했습니다", "error");
    } finally {
      setBusy(false);
    }
  };

  const hasErrors = !!errors && errors.length > 0;
  const importCount = summary ? summary.created + summary.updated : 0;
  const isEmpty = !!summary && !hasErrors && importCount === 0; // 헤더만 있는 빈 파일
  const canCommit = !!summary && !hasErrors && importCount > 0 && !busy;

  return (
    // 오버레이 클릭으로 닫지 않는다 — 텍스트 드래그 선택이 오버레이에서 끝나면 닫히기 때문
    <div className={modalStyles.modalOverlay}>
      <div className={styles.syncModal}>
        <div className={modalStyles.detailHeader}>
          <div className={modalStyles.detailHeaderTop}>
            <h2>일괄 등록</h2>
            <button className={modalStyles.detailCloseBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={modalStyles.detailBody}>
          <div className={styles.slotBar}>
            <div className={styles.grow} />
            {/* 양식은 '업로드하려는 사람'만 필요하다 — 툴바가 아니라 여기에 둔다 */}
            <button
              className={styles.workBtn}
              onClick={async () => {
                try {
                  await voiceApi.downloadTemplate(robotId, robotName);
                } catch (e) {
                  showToast(e instanceof Error ? e.message : "내려받지 못했습니다", "error");
                }
              }}
            >
              양식 다운로드 (엑셀)
            </button>
          </div>

          {/* 양식을 처음 여는 사람이 각 칸에 뭘 넣어야 하는지 바로 알도록 */}
          <details className={styles.guide} open>
            <summary>양식 작성법</summary>
            <div className={styles.guideBody}>
              <dl className={styles.guideList}>
                <div>
                  <dt>시나리오명</dt>
                  <dd>
                    질문 묶음의 이름. <b>같은 이름이면 갱신</b>됩니다. (예: 화장실 안내)
                  </dd>
                </div>
                <div>
                  <dt>동작</dt>
                  <dd>
                    <b>없음</b> · <b>안내</b> · <b>정지</b> 중 하나. &lsquo;안내&rsquo;는 질문에{" "}
                    <code>{SLOT_TOKEN}</code>가 있어야 합니다.
                  </dd>
                </div>
                <div>
                  <dt>질문</dt>
                  <dd>고객이 물어볼 법한 말. 최소 2개.</dd>
                </div>
                <div>
                  <dt>답변</dt>
                  <dd>로봇이 할 말. 2개 이상이면 그중 하나를 무작위로 말합니다.</dd>
                </div>
                <div>
                  <dt>활성</dt>
                  <dd>
                    <b>1</b> = 사용, <b>0</b> = 끔.
                  </dd>
                </div>
              </dl>
              <div className={styles.guideExample}>
                <span className={styles.guideExampleLabel}>팁</span>
                <span>
                  한 칸에 질문·답변을 여러 개 넣을 땐 <b>|</b>(세로줄)로 붙입니다.
                  <br />예: <code>화장실 어디예요|화장실 좀요</code>
                </span>
              </div>
            </div>
          </details>

          <div
            className={styles.drop}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0]);
            }}
          >
            {file ? (
              <b>{file.name}</b>
            ) : (
              <>엑셀 파일을 끌어다 놓거나 <b>파일 선택</b></>
            )}
            <div className={styles.dropSub}>
              .xlsx · .csv · 최대 {VOICE_LIMITS.importRows}행
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = ""; // 같은 파일을 다시 골라도 onChange 가 다시 뜨도록
            }}
          />

          {busy && <div className={styles.emptyState}>검증 중...</div>}

          {hasErrors && (
            <>
              <div className={`${styles.inline} ${styles.inlineErr}`}>
                <b>
                  {summary ? summary.totalRows : errors!.length}행 중 {errors!.length}행에 문제가
                  있습니다.
                </b>
                <br />
                <b>아무것도 등록되지 않았습니다.</b> CSV를 고쳐서 다시 올려 주세요.
              </div>
              <div className={styles.slotScroll} style={{ maxHeight: 160 }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}>행</th>
                      <th className={styles.thLeft}>시나리오명</th>
                      <th className={styles.thLeft}>사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors!.map((e, i) => (
                      <tr key={i}>
                        <td>{e.line}</td>
                        <td className={styles.tdLeft}>{e.name || "-"}</td>
                        <td className={styles.tdLeft}>{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {isEmpty && (
            <div className={`${styles.inline} ${styles.inlineInfo}`}>
              <b>등록할 내용이 없습니다.</b> 헤더 아래 줄에 시나리오를 채워 다시 올려 주세요.
            </div>
          )}

          {summary && !hasErrors && !isEmpty && (
            <>
              <div className={`${styles.inline} ${styles.inlineOk}`}>
                <b>{summary.totalRows}행 모두 정상</b> — 신규 <b>{summary.created}</b> · 갱신{" "}
                <b>{summary.updated}</b>
              </div>
              {summary.untouched > 0 && (
                <div className={`${styles.inline} ${styles.inlineInfo}`}>
                  파일에 없는 기존 시나리오 <b>{summary.untouched}건</b>
                  {summary.untouchedNames.length > 0 && (
                    <> ({summary.untouchedNames.join(", ")})</>
                  )}
                  은 <b>그대로 유지</b>됩니다. 지우려면 목록에서 선택해 삭제하세요.
                </div>
              )}
            </>
          )}
        </div>

        <div className={`${modalStyles.detailFooter} ${styles.footSplit}`}>
          <span className={styles.footNote}>
            {canCommit && summary && (
              <>
                시나리오 <b>{summary.created + summary.updated}</b>건이 등록됩니다
              </>
            )}
          </span>
          <div className={styles.footRight}>
            <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onClose}>
              취소
            </button>
            <button
              className={`${styles.btn} ${styles.btnPrimary} ${
                !canCommit ? styles.btnDisabled : ""
              }`}
              disabled={!canCommit}
              onClick={commit}
            >
              등록
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
