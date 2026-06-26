// 위험구역 유효성 검증 (순수 함수)

import type { DangerZone, ZonePoint } from "./types";
import { polygonArea, isSelfIntersecting } from "./geometry";

export type ValidationOptions = {
  /** 최소 면적 (월드 단위 m²). 기본 0.01 */
  minArea?: number;
  /** 이름 최대 길이. 기본 50 */
  maxNameLength?: number;
  /** 층 id 필수 여부. 기본 true */
  requireFloor?: boolean;
};

export type ValidationResult = {
  valid: boolean;
  errors: string[];
};

const DEFAULTS: Required<ValidationOptions> = {
  minArea: 0.01,
  maxNameLength: 50,
  requireFloor: true,
};

/**
 * 완성된 위험구역(폴리곤) 유효성 검증.
 * - 이름: 공백 불가, 길이 제한
 * - 꼭짓점: 최소 3개
 * - 면적: minArea 이상 (퇴화 폴리곤 차단)
 * - 자기교차 없음
 * - (옵션) 층 id 존재
 */
export function validateDangerZone(
  zone: Pick<DangerZone, "name" | "points" | "floorId">,
  options: ValidationOptions = {}
): ValidationResult {
  const opts = { ...DEFAULTS, ...options };
  const errors: string[] = [];

  const name = (zone.name ?? "").trim();
  if (!name) {
    errors.push("위험구역 이름을 입력해 주세요.");
  } else if (name.length > opts.maxNameLength) {
    errors.push(`이름은 ${opts.maxNameLength}자 이내여야 합니다.`);
  }

  const points = zone.points ?? [];
  if (points.length < 3) {
    errors.push("위험구역은 최소 3개의 점이 필요합니다.");
  } else {
    if (polygonArea(points) < opts.minArea) {
      errors.push("위험구역 면적이 너무 작습니다.");
    }
    if (isSelfIntersecting(points)) {
      errors.push("폴리곤이 자기교차합니다. 변이 겹치지 않게 그려 주세요.");
    }
  }

  if (opts.requireFloor && (zone.floorId === null || zone.floorId === undefined)) {
    errors.push("층을 선택해 주세요.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 그리기 도중 "닫기(완성)" 가능 여부 — 폴리곤으로 만들 최소 조건만 확인.
 * (이름/층 검증은 저장 단계에서 validateDangerZone 으로 수행)
 */
export function canClosePolygon(points: ZonePoint[], minArea = 0.01): boolean {
  if (points.length < 3) return false;
  if (polygonArea(points) < minArea) return false;
  if (isSelfIntersecting(points)) return false;
  return true;
}
