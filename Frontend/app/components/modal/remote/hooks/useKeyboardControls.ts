'use client';

import { useEffect, useRef, useCallback } from 'react';

type KeyMap = {
  endpoint: string;
  label: string;
};

const KEY_MAP: Record<string, KeyMap> = {
  w:          { endpoint: '/robot/up',        label: '전진' },
  arrowup:    { endpoint: '/robot/up',        label: '전진' },
  s:          { endpoint: '/robot/down',      label: '후진' },
  arrowdown:  { endpoint: '/robot/down',      label: '후진' },
  a:          { endpoint: '/robot/left',      label: '좌이동' },
  arrowleft:  { endpoint: '/robot/left',      label: '좌이동' },
  d:          { endpoint: '/robot/right',     label: '우이동' },
  arrowright: { endpoint: '/robot/right',     label: '우이동' },
  q:          { endpoint: '/robot/leftTurn',  label: '좌회전' },
  e:          { endpoint: '/robot/rightTurn', label: '우회전' },
  ' ':        { endpoint: '/robot/stop',      label: '정지' },
};

type UseKeyboardControlsOptions = {
  enabled: boolean;
  onMove: (endpoint: string) => void;
  onStop: () => void;
};

export function useKeyboardControls({ enabled, onMove, onStop }: UseKeyboardControlsOptions) {
  const activeKeyRef = useRef<string | null>(null);
  const throttleRef = useRef<number>(0);

  const isInputElement = useCallback((el: EventTarget | null): boolean => {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }, []);

  useEffect(() => {
    if (!enabled) {
      activeKeyRef.current = null;
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Space는 input 안에서도 stop으로 동작
      const key = e.key.toLowerCase();
      const mapping = KEY_MAP[key];
      if (!mapping) return;

      // input 요소에서는 Space(정지)만 허용
      if (isInputElement(e.target) && key !== ' ') return;

      e.preventDefault();

      // 정지 명령은 항상 즉시 실행
      if (mapping.endpoint === '/robot/stop') {
        onStop();
        activeKeyRef.current = null;
        return;
      }

      // press-and-hold: 이미 동일 키가 눌려있으면 무시 (키 리피트)
      if (activeKeyRef.current === key) return;

      // 쓰로틀 (200ms)
      const now = Date.now();
      if (now - throttleRef.current < 200) return;
      throttleRef.current = now;

      activeKeyRef.current = key;
      onMove(mapping.endpoint);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!KEY_MAP[key]) return;
      if (KEY_MAP[key].endpoint === '/robot/stop') return;

      // 현재 활성 키가 떼어진 키와 같으면 stop
      if (activeKeyRef.current === key) {
        activeKeyRef.current = null;
        onStop();
      }
    };

    // blur 시 안전하게 stop
    const handleBlur = () => {
      if (activeKeyRef.current) {
        activeKeyRef.current = null;
        onStop();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [enabled, onMove, onStop, isInputElement]);

  return { activeKey: activeKeyRef };
}

/** 키보드 힌트 매핑 (UI 표시용) */
export const KEYBOARD_HINTS: Record<string, string> = {
  '/robot/up': 'W',
  '/robot/down': 'S',
  '/robot/left': 'A',
  '/robot/right': 'D',
  '/robot/leftTurn': 'Q',
  '/robot/rightTurn': 'E',
  '/robot/stop': 'Space',
};
