'use client';

import React, { useEffect, useRef, useState } from 'react';
import styles from '@/app/components/modal/Modal.module.css';
import type { RobotRowData } from '@/app/types';
import { apiFetch } from '@/app/lib/api';

export type RobotEditDraft = {
  robotName: string;
  operator: string;
  serialNumber: string;
  model: string;
  group: string;
  softwareVersion: string;
  site: string;
  registrationDateTime: string;
  returnBattery: number;
  robotType: string;
};

type BatterySliderAPI = {
  value: number;
  min: number;
  max: number;
  sliderPercent: number;
  handleSliderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

type Props = {
  robot: RobotRowData | null;
  draft: RobotEditDraft;
  setDraft: React.Dispatch<React.SetStateAction<RobotEditDraft>>;
  fieldErrors: Record<string, boolean>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  battery: BatterySliderAPI;
  isSubmitting: boolean;
  onCancel: () => void;
  onSave: () => void;
};

const MODEL_OPTIONS = ["Lynx M20", "Lynx M20 Pro"];
const ROBOT_TYPES = ["기본 4족", "순찰 4족", "보안 4족"];

export default function RobotInfoEditSection({
  robot: r,
  draft,
  setDraft,
  fieldErrors,
  setFieldErrors,
  battery,
  isSubmitting,
  onCancel,
  onSave,
}: Props) {
  // 운영사 드롭다운
  const [bizList, setBizList] = useState<{ id: number; name: string }[]>([]);
  const [bizDropdownOpen, setBizDropdownOpen] = useState(false);
  const bizDropdownRef = useRef<HTMLDivElement>(null);

  // 모델 드롭다운
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  // 로봇 타입 드롭다운
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch(`/DB/businesses?size=10000`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data) => {
        const items = (data.items ?? []).map((b: any) => ({ id: b.id, name: b.BusinessName }));
        setBizList(items);
      })
      .catch(() => setBizList([]));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (bizDropdownRef.current && !bizDropdownRef.current.contains(e.target as Node)) {
        setBizDropdownOpen(false);
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (typeDropdownRef.current && !typeDropdownRef.current.contains(e.target as Node)) {
        setTypeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <div className={styles.itemBoxContainer}>
        {/* Row 1: 로봇명 / 로봇 타입 */}
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>
            로봇명 <span className={styles.requiredMark}>*</span>
          </div>
          <div className={styles.insertInputWrap}>
            <input
              type="text"
              maxLength={20}
              value={draft.robotName}
              onChange={(e) => {
                setDraft((p) => ({ ...p, robotName: e.target.value }));
                if (fieldErrors.robotName) setFieldErrors((p) => ({ ...p, robotName: false }));
              }}
              placeholder="20글자 이내로 작성해 주세요."
              className={fieldErrors.robotName ? styles.inputError : ''}
            />
            {fieldErrors.robotName && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
          </div>
        </div>
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>로봇 타입</div>
          <div className={styles.insertInputWrap}>
            <div ref={typeDropdownRef} className={styles.customSelectWrap}>
              <button
                type="button"
                className={styles.customSelectTrigger}
                onClick={() => { setTypeDropdownOpen((prev) => !prev); setBizDropdownOpen(false); setModelDropdownOpen(false); }}
                aria-label="로봇 타입"
              >
                <span style={{ color: draft.robotType ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  {draft.robotType || '기본 4족'}
                </span>
                <img
                  className={styles.customSelectArrow}
                  src={typeDropdownOpen ? '/icon/arrow_up.png' : '/icon/arrow_down.png'}
                  alt=""
                />
              </button>
              {typeDropdownOpen && (
                <div className={styles.customSelectDropdown}>
                  {ROBOT_TYPES.map((type) => (
                    <div
                      key={type}
                      className={`${styles.customSelectItem} ${draft.robotType === type ? styles.customSelectItemActive : ''}`}
                      onClick={() => {
                        setDraft((p) => ({ ...p, robotType: type }));
                        setTypeDropdownOpen(false);
                      }}
                    >
                      {type}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Row 2: 모델 / 운영사 */}
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>
            모델 <span className={styles.requiredMark}>*</span>
          </div>
          <div className={styles.insertInputWrap}>
            <div ref={modelDropdownRef} className={styles.customSelectWrap}>
              <button
                type="button"
                className={`${styles.customSelectTrigger} ${fieldErrors.model ? styles.inputError : ''}`}
                onClick={() => { setModelDropdownOpen((prev) => !prev); setBizDropdownOpen(false); setTypeDropdownOpen(false); }}
                aria-label="모델"
              >
                <span style={{ color: draft.model ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  {draft.model || '모델을 선택하세요'}
                </span>
                <img
                  className={styles.customSelectArrow}
                  src={modelDropdownOpen ? '/icon/arrow_up.png' : '/icon/arrow_down.png'}
                  alt=""
                />
              </button>
              {modelDropdownOpen && (
                <div className={styles.customSelectDropdown}>
                  {MODEL_OPTIONS.map((m) => (
                    <div
                      key={m}
                      className={`${styles.customSelectItem} ${draft.model === m ? styles.customSelectItemActive : ''}`}
                      onClick={() => {
                        setDraft((p) => ({ ...p, model: m }));
                        setModelDropdownOpen(false);
                        if (fieldErrors.model) setFieldErrors((p) => ({ ...p, model: false }));
                      }}
                    >
                      {m}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {fieldErrors.model && <div className={styles.errorMessage}>필수 선택 항목입니다.</div>}
          </div>
        </div>
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>
            운영사 <span className={styles.requiredMark}>*</span>
          </div>
          <div className={styles.insertInputWrap}>
            <div ref={bizDropdownRef} className={styles.customSelectWrap}>
              <button
                type="button"
                className={`${styles.customSelectTrigger} ${fieldErrors.operator ? styles.inputError : ''}`}
                onClick={() => { setBizDropdownOpen((prev) => !prev); setModelDropdownOpen(false); setTypeDropdownOpen(false); }}
                aria-label="운영사"
              >
                <span style={{ color: draft.operator ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                  {draft.operator || '운영사를 선택하세요'}
                </span>
                <img
                  className={styles.customSelectArrow}
                  src={bizDropdownOpen ? '/icon/arrow_up.png' : '/icon/arrow_down.png'}
                  alt=""
                />
              </button>
              {bizDropdownOpen && (
                <div className={styles.customSelectDropdown}>
                  {bizList.length === 0 ? (
                    <div className={styles.customSelectItem} style={{ color: 'var(--text-muted)' }}>
                      등록된 사업자가 없습니다
                    </div>
                  ) : (
                    bizList.map((b) => (
                      <div
                        key={b.id}
                        className={`${styles.customSelectItem} ${draft.operator === b.name ? styles.customSelectItemActive : ''}`}
                        onClick={() => {
                          setDraft((p) => ({ ...p, operator: b.name }));
                          setBizDropdownOpen(false);
                          if (fieldErrors.operator) setFieldErrors((p) => ({ ...p, operator: false }));
                        }}
                      >
                        {b.name}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            {fieldErrors.operator && <div className={styles.errorMessage}>필수 선택 항목입니다.</div>}
          </div>
        </div>
        {/* Row 3: 시리얼 번호 / S/W 버전 */}
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>
            시리얼 번호 <span className={styles.requiredMark}>*</span>
          </div>
          <div className={styles.insertInputWrap}>
            <input
              type="text"
              maxLength={20}
              value={draft.serialNumber}
              onChange={(e) => {
                setDraft((p) => ({ ...p, serialNumber: e.target.value }));
                if (fieldErrors.serialNumber) setFieldErrors((p) => ({ ...p, serialNumber: false }));
              }}
              placeholder="20글자 이내로 작성해 주세요."
              className={fieldErrors.serialNumber ? styles.inputError : ''}
            />
            {fieldErrors.serialNumber && <div className={styles.errorMessage}>필수 입력 항목입니다.</div>}
          </div>
        </div>
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>S/W 버전</div>
          <div className={styles.insertInputWrap}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: '36px' }}>
              {r?.softwareVersion ?? '-'}
            </span>
          </div>
        </div>
        {/* Row 4: 복귀 배터리양 / 등록일시 */}
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>
            복귀 배터리양 <span className={styles.batteryCurrentValue}>{battery.value}%</span>
          </div>
          <div className={styles.batterySliderWrap}>
            <div className={styles.batterySliderTrackArea}>
              <input
                className={styles.batterySlider}
                type="range"
                min={battery.min}
                max={battery.max}
                step={1}
                value={battery.value}
                onChange={battery.handleSliderChange}
                aria-label="복귀 배터리양 조정"
                style={{ ['--percent' as any]: `${battery.sliderPercent}%` }}
              />
            </div>
            <div className={styles.batterySliderLabels}>
              <span>{battery.min}%</span>
              <span>{battery.max}%</span>
            </div>
          </div>
        </div>
        <div className={styles.insertItemBox}>
          <div className={styles.insertItemLabel}>등록일시</div>
          <div className={styles.insertInputWrap}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: '36px' }}>
              {r?.registrationDateTime?.replace('T', ' ') ?? '-'}
            </span>
          </div>
        </div>

      </div>
      {/* 버튼 */}
      <div className={styles.insertBtnTotal}>
        <button
          type="button"
          className={`${styles.insertConfrimBtn} ${styles.btnBgRed}`}
          onClick={onCancel}
          disabled={isSubmitting}
        >
          <img src="/icon/close_btn.png" alt="cancel" />
          <span>취소</span>
        </button>
        <button
          type="button"
          className={`${styles.insertConfrimBtn} ${styles.btnBgBlue} ${isSubmitting ? styles.btnDisabled : ''}`}
          onClick={onSave}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <div className={styles.btnSpinner} />
          ) : (
            <img src="/icon/check.png" alt="save" style={{ verticalAlign: 'middle', flexShrink: 0 }} />
          )}
          <span style={{ lineHeight: 1 }}>{isSubmitting ? '저장 중...' : '저장'}</span>
        </button>
      </div>
    </>
  );
}
