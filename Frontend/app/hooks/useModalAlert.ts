"use client";

import { useState, useCallback } from "react";

type ModalState = {
  open: boolean;
  message: string;
  mode: "alert" | "confirm";
  onConfirm: (() => void) | null;
};

const INITIAL: ModalState = { open: false, message: "", mode: "alert", onConfirm: null };

/**
 * alert / confirm 을 커스텀 모달로 대체하는 훅.
 *
 * - modalAlert("메시지")  → 확인 버튼만
 * - modalConfirm("메시지", onConfirm)  → 취소 + 확인
 */
export function useModalAlert() {
  const [modal, setModal] = useState<ModalState>(INITIAL);

  const modalAlert = useCallback((message: string) => {
    setModal({ open: true, message, mode: "alert", onConfirm: null });
  }, []);

  const modalConfirm = useCallback((message: string, onConfirm: () => void) => {
    setModal({ open: true, message, mode: "confirm", onConfirm });
  }, []);

  const closeModal = useCallback(() => setModal(INITIAL), []);

  const handleConfirm = useCallback(() => {
    modal.onConfirm?.();
    setModal(INITIAL);
  }, [modal]);

  return { modal, modalAlert, modalConfirm, closeModal, handleConfirm };
}
