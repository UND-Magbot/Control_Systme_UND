"use client";

import { useState, useCallback } from "react";

type AlertState = {
  isOpen: boolean;
  message: string;
};

/**
 * 알림 모달 상태를 관리하는 훅.
 * 여러 개의 독립적인 알림(배터리, API 에러, 성공 등)을 하나의 훅으로 관리.
 */
export function useAlertModal() {
  const [state, setState] = useState<AlertState>({
    isOpen: false,
    message: "",
  });

  const show = useCallback((message: string) => {
    setState({ isOpen: true, message });
  }, []);

  const close = useCallback(() => {
    setState({ isOpen: false, message: "" });
  }, []);

  return {
    isOpen: state.isOpen,
    message: state.message,
    show,
    close,
  };
}
