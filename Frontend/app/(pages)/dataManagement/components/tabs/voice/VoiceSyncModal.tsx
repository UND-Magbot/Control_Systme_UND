"use client";

import React, { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/app/components/common/Toast";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./voice.module.css";
import { voiceApi, type ApplyTarget } from "./voiceApi";

type Props = {
  robotId: number;
  onClose: () => void;
  onApplied: () => void;
};

type Progress = {
  robotId: number;
  robotName: string;
  status: "waiting" | "running" | "success" | "failed";
  msg: string;
  step: number;
  synthesized: number;
  error?: string;
};

/**
 * 로봇 적용.
 *
 * 로봇 1대 = 독립 트랜잭션이라 부분 실패를 허용한다(CSV 일괄 등록의 '전량 거부'와 반대처럼
 * 보이지만 모순이 아니다 — 로봇에 들어간 번들은 그 자체로 완결이다).
 */
export default function VoiceSyncModal({ robotId, onClose, onApplied }: Props) {
  const { showToast } = useToast();

  const [targets, setTargets] = useState<ApplyTarget[]>([]);
  const [checked, setChecked] = useState<number[]>([robotId]);
  const [phase, setPhase] = useState<"select" | "running" | "done">("select");
  const [progress, setProgress] = useState<Record<number, Progress>>({});

  const load = useCallback(async () => {
    try {
      const res = await voiceApi.applyTargets(robotId);
      setTargets(res.items);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "대상을 불러오지 못했습니다", "error");
    }
  }, [robotId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const selectable = targets.filter((t) => t.selectable);
  const overwritten = targets.filter(
    (t) => checked.includes(t.robotId) && !t.isSource && t.ownIntentCount > 0
  );

  const run = async (ids: number[]) => {
    if (ids.length === 0) return;
    setPhase("running");
    setProgress(
      Object.fromEntries(
        ids.map((id) => [
          id,
          {
            robotId: id,
            robotName: targets.find((t) => t.robotId === id)?.robotName ?? `#${id}`,
            status: "waiting",
            msg: "대기 중",
            step: 0,
            synthesized: 0,
          } as Progress,
        ])
      )
    );

    try {
      const res = await voiceApi.sync(robotId, ids);
      if (!res.ok || !res.body) throw new Error(`적용에 실패했습니다 (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      // NDJSON 스트리밍 — 맵 동기화와 같은 패턴
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          const rid = Number(evt.robotId);
          setProgress((prev) => {
            const cur = prev[rid];
            if (!cur) return prev;
            const next: Progress = { ...cur };
            switch (evt.event) {
              case "start":
                next.status = "running";
                next.msg = "설정 전송";
                break;
              case "step":
                next.status = "running";
                next.step = Number(evt.step ?? next.step);
                next.msg = String(evt.msg ?? next.msg);
                break;
              case "synth":
                next.status = "running";
                next.msg = `음성 합성 (${evt.done ?? 0}/${evt.total ?? 0})`;
                next.synthesized = Number(evt.done ?? 0);
                break;
              case "done":
                next.status = "success";
                next.msg = `완료 · 신규 합성 ${evt.synthesized ?? 0}`;
                break;
              case "failed":
                next.status = "failed";
                next.error = String(evt.error ?? "실패");
                break;
            }
            return { ...prev, [rid]: next };
          });
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "적용에 실패했습니다", "error");
    } finally {
      setPhase("done");
      onApplied();
    }
  };

  const results = Object.values(progress);
  const failed = results.filter((r) => r.status === "failed");
  const succeeded = results.filter((r) => r.status === "success");

  return (
    <div className={modalStyles.modalOverlay} onClick={phase === "running" ? undefined : onClose}>
      <div className={styles.syncModal} onClick={(e) => e.stopPropagation()}>
        <div className={modalStyles.detailHeader}>
          <div className={modalStyles.detailHeaderTop}>
            <h2>
              {phase === "select"
                ? "로봇 적용"
                : phase === "running"
                ? "로봇 적용 중 ..."
                : "적용 완료"}
            </h2>
            {phase !== "running" && (
              <button className={modalStyles.detailCloseBtn} onClick={onClose}>
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className={modalStyles.detailBody}>
          {phase === "select" ? (
            <>
              <p className={styles.hint}>이 로봇의 음성 시나리오를 아래 로봇에 적용합니다.</p>
              <div className={styles.pickCount}>
                적용 대상 <b>{checked.length}</b> / 선택 가능 {selectable.length} · 전체{" "}
                {targets.length}
              </div>

              <div className={styles.pickList}>
                {targets.map((t) => (
                  <label
                    key={t.robotId}
                    className={`${styles.pickItem} ${!t.selectable ? styles.pickOff : ""} ${
                      checked.includes(t.robotId) ? styles.pickOn : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!t.selectable}
                      checked={checked.includes(t.robotId)}
                      onChange={() =>
                        setChecked((prev) =>
                          prev.includes(t.robotId)
                            ? prev.filter((v) => v !== t.robotId)
                            : [...prev, t.robotId]
                        )
                      }
                    />
                    <div className={styles.pickInfo}>
                      <div className={styles.pickName}>{t.robotName}</div>
                      <div className={styles.pickMeta}>
                        {t.robotType ?? "-"}
                        {t.isSource ? " · 편집 원본" : ""}
                        {!t.isSource && t.ownIntentCount > 0
                          ? ` · 자체 시나리오 ${t.ownIntentCount}건`
                          : ""}
                      </div>
                    </div>
                    {t.reason && <span className={styles.pickTag}>{t.reason}</span>}
                  </label>
                ))}
              </div>

              {overwritten.length > 0 && (
                <div className={`${styles.inline} ${styles.inlineWarn}`}>
                  <b>{overwritten.map((t) => t.robotName).join(", ")}</b>의 기존 시나리오가
                  대체됩니다. 목적지는 <b>로봇마다 맵이 달라 자동 재연결되지 않습니다</b> — 적용 후
                  목적지 사전을 확인하세요.
                </div>
              )}
            </>
          ) : (
            <div className={styles.syncList}>
              {results.map((p) => (
                <div key={p.robotId} className={styles.syncItem}>
                  <span className={styles.syncName}>{p.robotName}</span>
                  <span className={styles.syncStatus}>
                    {p.status === "waiting" && <span className={styles.syncWait}>대기 중</span>}
                    {p.status === "running" && (
                      <span className={styles.syncMsg}>
                        {p.msg} {p.step > 0 ? `... ${p.step}/3` : ""}
                      </span>
                    )}
                    {p.status === "success" && <span className={styles.syncOk}>{p.msg}</span>}
                    {p.status === "failed" && (
                      <span className={styles.syncFail}>실패 ({p.error})</span>
                    )}
                  </span>
                </div>
              ))}

              {phase === "done" && (
                <div className={`${styles.inline} ${styles.inlineInfo}`}>
                  성공 <b>{succeeded.length}대</b> · 실패 <b>{failed.length}대</b>. 성공한 로봇만
                  최근 적용 일시가 갱신됩니다. 실패한 로봇은 목록에 <b>미적용</b>으로 남고, 이전에
                  적용된 내용으로 계속 동작합니다.
                </div>
              )}
            </div>
          )}
        </div>

        {phase === "select" && (
          <div className={`${modalStyles.detailFooter} ${styles.footSplit}`}>
            {/* 개수는 버튼 라벨이 아니라 푸터 문구에 — 라벨이 길어지면 버튼이 깨진다 */}
            <span className={styles.footNote}>
              로봇 <b>{checked.length}</b>대에 적용됩니다
            </span>
            <div className={styles.footRight}>
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onClose}>
                취소
              </button>
              <button
                className={`${styles.btn} ${styles.btnPrimary} ${
                  checked.length === 0 ? styles.btnDisabled : ""
                }`}
                disabled={checked.length === 0}
                onClick={() => run(checked)}
              >
                적용
              </button>
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className={modalStyles.detailFooter}>
            <div className={styles.footRight}>
              <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onClose}>
                닫기
              </button>
              {failed.length > 0 && (
                <button
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => run(failed.map((f) => f.robotId))}
                >
                  재시도
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
