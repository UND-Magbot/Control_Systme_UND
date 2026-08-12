"use client";

// 방향(yaw) 입력 공통 컴포넌트 — 저장은 절대 ROS yaw(도) 그대로, 입력만 직관화.
//   ① 다이얼 클릭/드래그로 "로봇이 바라볼 방향"을 가리킴 (주 입력)
//   ② "현재 로봇 방향" 버튼(teach) — 로봇을 세운 뒤 그 방향을 가져옴
//   ③ 숫자(도) 직접 입력 — 부차 (0=동, 반시계; 로봇 텔레메트리와 동일)
// 규약: yaw.ts (0=지도+X(동)·CCW). 화면 다이얼 N=위(북)/E=오른쪽(동).
import { useCallback, useRef } from "react";

import { degFromYaw, degFromWheelAngle, arrowRotationDeg } from "@/app/lib/yaw";
import styles from "./DirectionPicker.module.css";

interface DirectionPickerProps {
  /** 방향 도(0~360) 문자열 — 모달 state와 동일 규약 */
  value: string;
  onChange: (deg: string) => void;
  /** 로봇 현재 yaw(라디안). 있으면 '현재 로봇 방향' 활성 */
  liveRobotYawRad?: number | null;
  /** true면 읽기전용(예: '현 위치에서 등록' 잠금) */
  disabled?: boolean;
  error?: string;
  label?: string;
}

export default function DirectionPicker({
  value,
  onChange,
  liveRobotYawRad,
  disabled = false,
  error,
  label = "로봇이 바라볼 방향",
}: DirectionPickerProps) {
  const dialRef = useRef<HTMLDivElement>(null);

  // 다이얼 위의 한 점 → 방향 도. atan2(dx,-dy)=화면 위 기준 시계각 → degFromWheelAngle.
  const setFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = dialRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const angle = (Math.atan2(clientX - cx, -(clientY - cy)) * 180) / Math.PI;
      onChange(String(degFromWheelAngle(angle)));
    },
    [onChange],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    setFromPoint(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => setFromPoint(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const useRobotDirection = () => {
    if (disabled || liveRobotYawRad == null) return;
    onChange(String(degFromYaw(Number(liveRobotYawRad))));
  };

  const onNumChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let v = e.target.value;
    if (v === "" || v === "-") {
      onChange(v);
      return;
    }
    const n = Number(v);
    if (Number.isNaN(n)) return;
    if (n < 0) v = "0";
    else if (n > 360) v = "360";
    onChange(v);
  };

  const hasVal = value !== "" && value != null;
  const canTeach = !disabled && liveRobotYawRad != null;

  return (
    <div className={styles.wrap}>
      <div className={styles.label}>{label}</div>
      <div className={styles.body}>
        <div
          ref={dialRef}
          className={`${styles.dial} ${disabled ? styles.dialDisabled : ""}`}
          onPointerDown={onPointerDown}
          role="slider"
          aria-label="방향 다이얼"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={hasVal ? Number(value) : undefined}
          aria-disabled={disabled}
          title={disabled ? "로봇 현재 방향" : "화살표를 로봇이 바라볼 방향으로 끌어 맞추세요"}
        >
          <span className={`${styles.tick} ${styles.tickN}`}>N</span>
          <span className={`${styles.tick} ${styles.tickE}`}>E</span>
          <span className={`${styles.tick} ${styles.tickS}`}>S</span>
          <span className={`${styles.tick} ${styles.tickW}`}>W</span>
          {hasVal && (
            <div
              className={styles.arrow}
              style={{ transform: `rotate(${arrowRotationDeg(Number(value))}deg)` }}
            />
          )}
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.teachBtn}
            onClick={useRobotDirection}
            disabled={!canTeach}
            title="로봇을 원하는 방향으로 세운 뒤 클릭하면 그 방향을 가져옵니다"
          >
            현재 로봇 방향
          </button>
          <div className={styles.numRow}>
            <input
              className={styles.numInput}
              type="number"
              min={0}
              max={360}
              value={value}
              placeholder="0~360"
              disabled={disabled}
              onChange={onNumChange}
            />
            <span className={styles.unit}>
              °<span className={styles.hint}> (0=동, 반시계)</span>
            </span>
          </div>
          <div className={styles.help}>
            {disabled ? "로봇 현재 방향으로 고정됨" : "화살표를 끌거나, 로봇을 세우고 “현재 로봇 방향”"}
          </div>
        </div>
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
