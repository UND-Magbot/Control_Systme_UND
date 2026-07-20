'use client';

import { createContext, useContext, useMemo } from 'react';

/**
 * 원격 제어 세션 컨텍스트 — 대상 로봇과 제어권 토큰을 한 곳에서 공급한다.
 *
 * 명령을 보내는 곳이 모달 안에 여러 갈래로 흩어져 있어(이동 패드·보행·조명·자세),
 * 각자 props 로 받게 하면 한 곳만 빠져도 "제어권 없음(409)" 이 조용히 생긴다.
 * 그래서 세션 정보는 컨텍스트로 내려보내고, `useRemoteCommand` 가 기본값으로 읽는다.
 */

export type RemoteSession = {
  /** 조작 대상 로봇. null 이면 레거시 경로로 나가고 서버가 폴백한다. */
  robotId: number | null;
  /** 제어권 토큰 헤더. 제어 중이 아니면 빈 객체 — 서버가 409로 막는다. */
  controlHeaders: () => Record<string, string>;
};

const EMPTY: RemoteSession = {
  robotId: null,
  controlHeaders: () => ({}),
};

const RemoteSessionContext = createContext<RemoteSession>(EMPTY);

export function RemoteSessionProvider({
  robotId,
  controlHeaders,
  children,
}: RemoteSession & { children: React.ReactNode }) {
  const value = useMemo(
    () => ({ robotId, controlHeaders }),
    [robotId, controlHeaders],
  );
  return (
    <RemoteSessionContext.Provider value={value}>{children}</RemoteSessionContext.Provider>
  );
}

export function useRemoteSession(): RemoteSession {
  return useContext(RemoteSessionContext);
}

/** `/robot/up` → `/robot/{id}/up`. 대상이 없으면 원본 경로 그대로. */
export function scopeRobotPath(path: string, robotId: number | null): string {
  if (robotId == null) return path;
  return path.startsWith('/robot/') ? `/robot/${robotId}/${path.slice(7)}` : path;
}
