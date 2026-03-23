"use client";

import { useState, useRef, useMemo } from "react";

type UseBatterySliderOptions = {
  min?: number;
  max?: number;
  defaultValue?: number;
};

export function useBatterySlider({
  min = 15,
  max = 30,
  defaultValue = 30,
}: UseBatterySliderOptions = {}) {
  const [value, setValue] = useState<number>(defaultValue);
  const [text, setText] = useState<string>(String(defaultValue));
  const lastValidRef = useRef<number>(defaultValue);

  // 알림 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertMsg, setAlertMsg] = useState("");

  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const commitByNumber = (n: number) => {
    const v = clamp(n);
    setValue(v);
    setText(String(v));
    lastValidRef.current = v;
  };

  const sliderPercent = useMemo(() => {
    const p = ((value - min) / (max - min)) * 100;
    return Number.isFinite(p) ? p : 0;
  }, [value, min, max]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    commitByNumber(Number(e.target.value));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (!/^\d*$/.test(raw)) return;

    setText(raw);
    if (raw === "") return;

    const n = Number(raw);
    if (Number.isNaN(n)) return;

    if (n >= min && n <= max) {
      commitByNumber(n);
    }
  };

  const validateAndFix = () => {
    const raw = text.trim();
    if (raw === "") {
      commitByNumber(lastValidRef.current);
      return true;
    }

    const n = Number(raw);
    if (Number.isNaN(n) || n < min || n > max) {
      setAlertMsg(
        `복귀 배터리양은 ${min}~${max} 범위내에서 숫자만 직접 기입하거나 \n 최소 복귀 배터리양 조정바로 설정해 주세요.`
      );
      setAlertOpen(true);
      commitByNumber(lastValidRef.current);
      return false;
    }
    commitByNumber(n);
    return true;
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      validateAndFix();
    }
  };

  /** 모달 오픈 시 초기값으로 리셋 */
  const reset = (initial?: number) => {
    const v = initial ?? defaultValue;
    setValue(v);
    setText(String(v));
    lastValidRef.current = v;
    setAlertOpen(false);
    setAlertMsg("");
  };

  return {
    value,
    text,
    sliderPercent,
    min,
    max,
    handleSliderChange,
    handleInputChange,
    handleInputKeyDown,
    validateAndFix,
    commitByNumber,
    reset,
    alertOpen,
    alertMsg,
    closeAlert: () => setAlertOpen(false),
  };
}
