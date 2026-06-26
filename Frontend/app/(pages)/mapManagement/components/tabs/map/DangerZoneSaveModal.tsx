"use client";

// 위험구역 그리기 완료 후 이름을 입력받아 저장(pending)하는 모달.
// 좌표(폴리곤)는 이미 그려졌고, 여기서는 이름만 확정한다. (층/맵은 현재 선택값 사용)

import React, { useEffect, useRef, useState } from "react";
import { useModalBehavior } from "@/app/hooks/useModalBehavior";
import styles from "./MapPlaceCreateModal.module.css";
import type { ZonePoint } from "../../../dangerZone/types";
import { polygonArea } from "../../../dangerZone/geometry";

type Props = {
  isOpen: boolean;
  points: ZonePoint[];
  /** 무게중심 (표시용) */
  centroid: ZonePoint;
  floorName?: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
};

export default function DangerZoneSaveModal({
  isOpen,
  points,
  centroid,
  floorName = "",
  onClose,
  onConfirm,
}: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useModalBehavior({ isOpen, onClose });

  const canSave = name.trim().length > 0;
  const area = polygonArea(points);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("위험구역 이름을 입력해 주세요.");
      return;
    }
    onConfirm(trimmed);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onEnter = (e: KeyboardEvent) => {
      if (e.key === "Enter" && canSave) {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener("keydown", onEnter);
    return () => document.removeEventListener("keydown", onEnter);
  }, [isOpen, canSave, name]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <img src="/icon/robot_place_w.png" alt="" />
            <h2>위험구역 등록</h2>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="close">
            &#10005;
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.sectionGroup}>
            <div className={styles.sectionTitle}>
              구역 정보<span className={styles.sectionTitleLine} />
            </div>

            {/* 이름 */}
            <div className={styles.row}>
              <div className={`${styles.label} ${styles.required}`}>구역명</div>
              <div className={styles.inputWrap}>
                <input
                  ref={inputRef}
                  className={`${styles.input} ${styles.edit} ${error ? styles.inputError : ""}`}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  placeholder="50자 이내로 작성하세요"
                  maxLength={50}
                />
                {error && <div className={styles.fieldError}>{error}</div>}
              </div>
            </div>

            {/* 요약 정보 (읽기 전용) */}
            <div className={styles.row}>
              <div className={styles.label}>층</div>
              <div className={styles.inputWrap}>
                <input
                  className={`${styles.input}`}
                  value={floorName || "(현재 선택 층)"}
                  readOnly
                  tabIndex={-1}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.label}>꼭짓점 / 면적</div>
              <div className={styles.inputWrap}>
                <input
                  className={`${styles.input}`}
                  value={`${points.length}개 · ${area.toFixed(2)} m²`}
                  readOnly
                  tabIndex={-1}
                />
              </div>
            </div>
            <div className={styles.row}>
              <div className={styles.label}>중심 좌표</div>
              <div className={styles.inputWrap}>
                <input
                  className={`${styles.input}`}
                  value={`(${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)})`}
                  readOnly
                  tabIndex={-1}
                />
              </div>
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button className={`${styles.footerBtn} ${styles.btnRed}`} onClick={onClose}>
            <img src="/icon/close_btn.png" alt="" />
            취소
          </button>
          <button
            className={`${styles.footerBtn} ${styles.btnBlue}`}
            onClick={submit}
            disabled={!canSave}
          >
            <img src="/icon/check.png" alt="" />
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
