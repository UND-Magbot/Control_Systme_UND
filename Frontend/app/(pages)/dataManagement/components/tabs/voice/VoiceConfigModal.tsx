"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/app/components/common/Toast";
import CustomSelect from "@/app/components/select/CustomSelect";
import { VOICE_LIMITS } from "@/app/constants/voice";
import modalStyles from "@/app/components/modal/Modal.module.css";
import styles from "./voice.module.css";
import { voiceApi, type VoiceConfig, type VoiceModule } from "./voiceApi";

type Props = {
  robotId: number;
  robotName: string;
  onClose: () => void;
  onModuleChanged?: () => void;
};

const DEFAULTS = {
  fallbackResponse: "죄송합니다. 다시 한 번 말씀해 주시겠어요?",
  matchThreshold: 0.55,
  slotFuzzyThreshold: 0.75,
  confirmOnAction: false,
};

const CONFIRM_OPTIONS = [
  { id: 0, label: "사용 안 함" },
  { id: 1, label: "사용 — 이동·정지 전에 되묻습니다" },
];

/**
 * 음성 설정 — 관리자 전용.
 *
 * SttModel · SilenceMs · TtsSpeed 는 노출하지 않는다. 잘못 만지면 인식률이 붕괴하는데
 * 운영자가 되돌릴 방법이 없다. 필요하면 개발자가 DB로 조정한다.
 */
export default function VoiceConfigModal({ robotId, robotName, onClose, onModuleChanged }: Props) {
  const { showToast } = useToast();
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  const [mod, setMod] = useState<VoiceModule | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, m] = await Promise.all([
          voiceApi.getConfig(robotId),
          voiceApi.getModule(robotId),
        ]);
        setCfg(c);
        setMod(m);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "설정을 불러오지 못했습니다", "error");
      }
    })();
  }, [robotId, showToast]);

  // 음성 모듈이 있어야 로봇이 말을 할 수 있다. RobotType 으로 추정하지 않고 여기서 등록한다.
  const saveModule = async () => {
    if (!mod) return;
    setSaving(true);
    try {
      const res = await voiceApi.saveModule(robotId, {
        isActive: mod.isActive ?? true,
        isBuiltIn: mod.isBuiltIn ?? true,
        host: mod.isBuiltIn ? null : mod.host ?? null,
        port: mod.port ?? 8090,
        hasMic: mod.hasMic ?? false,
        hasSpeaker: mod.hasSpeaker ?? true,
      });
      showToast(
        res.seededIntents > 0
          ? `음성 모듈을 등록하고 기본 시나리오 ${res.seededIntents}건을 만들었습니다`
          : "음성 모듈을 저장했습니다",
        "success"
      );
      setMod(await voiceApi.getModule(robotId));
      onModuleChanged?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "저장에 실패했습니다", "error");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await voiceApi.updateConfig(robotId, {
        fallbackResponse: cfg.fallbackResponse,
        matchThreshold: cfg.matchThreshold,
        slotFuzzyThreshold: cfg.slotFuzzyThreshold,
        confirmOnAction: cfg.confirmOnAction,
      });
      showToast("저장했습니다. 로봇에 반영하려면 [로봇 적용]을 누르세요", "success");
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "저장에 실패했습니다", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!cfg) return null;
  const readOnly = !cfg.canEdit;

  return (
    // 오버레이 클릭으로 닫지 않는다 — 텍스트를 드래그 선택하다 오버레이에서 놓으면
    // 클릭으로 오인돼 닫히기 때문. 닫기는 X·취소 버튼으로만.
    <div className={modalStyles.modalOverlay}>
      <div className={styles.syncModal}>
        <div className={modalStyles.detailHeader}>
          <div className={modalStyles.detailHeaderTop}>
            <h2>음성 설정 · {robotName}</h2>
            <button className={modalStyles.detailCloseBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className={modalStyles.detailBody}>
          {mod && (
            <div className={styles.moduleBox}>
              <div className={styles.moduleHead}>
                <b>음성 모듈</b>
                <span className={styles.moduleState}>
                  {!mod.exists
                    ? "등록되지 않음 — 이 로봇은 말을 할 수 없습니다"
                    : mod.isActive
                    ? `사용 중 · ${mod.effectiveHost ?? "-"}:${mod.port}`
                    : "꺼짐"}
                </span>
              </div>

              {/* 미등록일 때 체크박스가 '이미 켜진 상태'로 오해되지 않도록 — 등록 시 적용될 값임을 밝힌다 */}
              {!mod.exists && (
                <p className={styles.moduleIntro}>
                  아직 등록 전입니다. 아래 값을 확인하고 <b>[음성 모듈 등록]</b>을 누르면 이
                  설정으로 등록됩니다.
                </p>
              )}

              <div className={styles.moduleRow}>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    disabled={!mod.canEdit}
                    checked={mod.isActive ?? true}
                    onChange={(e) => setMod({ ...mod, isActive: e.target.checked })}
                  />
                  <span>사용</span>
                </label>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    disabled={!mod.canEdit}
                    checked={mod.isBuiltIn ?? true}
                    onChange={(e) => setMod({ ...mod, isBuiltIn: e.target.checked })}
                  />
                  <span>로봇에 내장</span>
                </label>
              </div>

              {/* 능력 플래그 — 마이크가 없으면 상시 대기 호출 방식이 버튼으로 고정된다 */}
              <div className={styles.moduleRow}>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    disabled={!mod.canEdit}
                    checked={mod.hasMic ?? false}
                    onChange={(e) => setMod({ ...mod, hasMic: e.target.checked })}
                  />
                  <span>마이크 있음</span>
                </label>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    disabled={!mod.canEdit}
                    checked={mod.hasSpeaker ?? true}
                    onChange={(e) => setMod({ ...mod, hasSpeaker: e.target.checked })}
                  />
                  <span>스피커 있음</span>
                </label>
              </div>
              {!(mod.hasMic ?? false) && (
                <div className={styles.moduleRow}>
                  <span className={styles.moduleAddrNote}>
                    마이크가 없으면 상시 대기 호출 방식이 <b>버튼</b>으로 고정됩니다.
                  </span>
                </div>
              )}

              {mod.isBuiltIn ?? true ? (
                // 내장이면 로봇 IP를 쓴다 — 어떤 주소로 접속하는지 회색으로 명시한다
                <div className={styles.moduleRow}>
                  <span className={styles.moduleAddr}>
                    접속 주소: <b>{mod.effectiveHost ?? "로봇 IP 미설정"}</b>:{mod.port ?? 8090}
                    <span className={styles.moduleAddrNote}> (로봇 IP 자동 사용)</span>
                  </span>
                </div>
              ) : (
                <div className={styles.moduleRow}>
                  <input
                    className={styles.moduleInput}
                    placeholder="음성 장치 IP (예: 10.21.31.10)"
                    disabled={!mod.canEdit}
                    value={mod.host ?? ""}
                    onChange={(e) => setMod({ ...mod, host: e.target.value })}
                  />
                  <input
                    className={styles.moduleInput}
                    style={{ width: 90 }}
                    type="number"
                    placeholder="포트"
                    disabled={!mod.canEdit}
                    value={mod.port ?? 8090}
                    onChange={(e) => setMod({ ...mod, port: Number(e.target.value) })}
                  />
                </div>
              )}

              {mod.canEdit && (
                <button
                  className={`${styles.workBtn} ${saving ? styles.btnDisabled : ""}`}
                  disabled={saving}
                  onClick={saveModule}
                >
                  {mod.exists ? "음성 모듈 저장" : "음성 모듈 등록"}
                </button>
              )}
            </div>
          )}

          <div className={styles.formGridFull}>
            <div className={styles.formRow}>
              <label>인식하지 못했을 때 답변</label>
              <textarea
                value={cfg.fallbackResponse}
                maxLength={VOICE_LIMITS.fallback}
                disabled={readOnly}
                rows={2}
                onChange={(e) => setCfg({ ...cfg, fallbackResponse: e.target.value })}
              />
            </div>

            <div className={styles.formTwo}>
              <div className={styles.formRow}>
                <label>매칭 임계값</label>
                <input
                  className={styles.noSpin}
                  type="number"
                  step={0.05}
                  min={0.1}
                  max={0.95}
                  value={cfg.matchThreshold}
                  disabled={readOnly}
                  onChange={(e) =>
                    setCfg({ ...cfg, matchThreshold: Number(e.target.value) })
                  }
                />
                <p className={styles.hint}>
                  낮추면 더 잘 알아듣지만 <b>오인식</b>이 늡니다.
                </p>
              </div>

              <div className={styles.formRow}>
                <label>목적지 퍼지 임계값</label>
                <input
                  className={styles.noSpin}
                  type="number"
                  step={0.05}
                  min={0.5}
                  max={0.99}
                  value={cfg.slotFuzzyThreshold}
                  disabled={readOnly}
                  onChange={(e) =>
                    setCfg({ ...cfg, slotFuzzyThreshold: Number(e.target.value) })
                  }
                />
                <p className={styles.hint}>비슷하게 들린 목적지를 흡수하는 정도입니다.</p>
              </div>
            </div>

            <div className={styles.formRow}>
              <label>이동·정지 전 재확인</label>
              <CustomSelect
                options={CONFIRM_OPTIONS}
                value={CONFIRM_OPTIONS[cfg.confirmOnAction ? 1 : 0]}
                onChange={(o) => setCfg({ ...cfg, confirmOnAction: Number(o.id) === 1 })}
                placeholder="선택"
                disabled={readOnly}
                overlay
              />
              <p className={styles.hint}>
                켜면 로봇이 움직이기 전에 <b>&quot;응급실로 안내할까요?&quot;</b>라고 음성 안내로
                한 번 되묻습니다. 잘못 알아들었을 때 엉뚱한 곳으로 가는 것을 막아 줍니다.
              </p>
            </div>
          </div>

          {readOnly && (
            <div className={`${styles.inline} ${styles.inlineInfo}`}>
              음성 설정은 <b>관리자만</b> 변경할 수 있습니다.
            </div>
          )}
        </div>

        <div className={`${modalStyles.detailFooter} ${styles.footSplit}`}>
          <button
            className={`${styles.btn} ${styles.btnNeutral} ${readOnly ? styles.btnDisabled : ""}`}
            disabled={readOnly}
            onClick={() => setCfg({ ...cfg, ...DEFAULTS })}
          >
            기본값 복원
          </button>
          <div className={styles.footRight}>
            <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onClose}>
              취소
            </button>
            <button
              className={`${styles.btn} ${styles.btnPrimary} ${
                readOnly || saving ? styles.btnDisabled : ""
              }`}
              disabled={readOnly || saving}
              onClick={save}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
