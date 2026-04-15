/** 하루 분(minute-of-day) 범위 파싱 및 정규화 유틸. */

export type ParsedMinutes = {
  value: number | null;
  isMinutesOfDay: boolean;
};

export function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 24 * 60) return 24 * 60;
  return Math.round(value);
}

export function parseMinuteValue(input: number | string): ParsedMinutes {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { value: null, isMinutesOfDay: false };
    if (input >= 60) return { value: input, isMinutesOfDay: true };
    return { value: input, isMinutesOfDay: false };
  }

  const raw = input.trim();
  if (!raw) return { value: null, isMinutesOfDay: false };

  const hhmmMatch = raw.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (hhmmMatch) {
    const h = Number(hhmmMatch[1]);
    const m = Number(hhmmMatch[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { value: h * 60 + m, isMinutesOfDay: true };
    }
  }

  const exprMatch = raw.match(/^\s*(\d{1,2})\s*\*\s*60\s*\+\s*(\d{1,2})\s*$/);
  if (exprMatch) {
    const h = Number(exprMatch[1]);
    const m = Number(exprMatch[2]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { value: h * 60 + m, isMinutesOfDay: true };
    }
  }

  const num = Number(raw);
  if (Number.isFinite(num)) {
    return { value: num, isMinutesOfDay: num >= 60 };
  }

  const looseNumbers = raw.match(/\d+/g);
  if (looseNumbers && looseNumbers.length >= 2) {
    const h = Number(looseNumbers[0]);
    const m = Number(looseNumbers[1]);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      return { value: h * 60 + m, isMinutesOfDay: true };
    }
  } else if (looseNumbers && looseNumbers.length === 1) {
    const only = Number(looseNumbers[0]);
    if (Number.isFinite(only)) {
      return { value: only, isMinutesOfDay: only >= 60 };
    }
  }

  return { value: null, isMinutesOfDay: false };
}

export function normalizeMinuteRange(
  startValue: number | string,
  endValue: number | string,
): { startMin: number; endMin: number } {
  const startParsed = parseMinuteValue(startValue);
  const endParsed = parseMinuteValue(endValue);

  if (!Number.isFinite(startParsed.value ?? NaN) || !Number.isFinite(endParsed.value ?? NaN)) {
    return { startMin: 0, endMin: 0 };
  }

  const startNum = startParsed.value as number;
  const endNum = endParsed.value as number;
  const treatAsHours =
    !startParsed.isMinutesOfDay && !endParsed.isMinutesOfDay && startNum <= 24 && endNum <= 24;
  const factor = treatAsHours ? 60 : 1;

  return {
    startMin: clampMinutes(startNum * factor),
    endMin: clampMinutes(endNum * factor),
  };
}
