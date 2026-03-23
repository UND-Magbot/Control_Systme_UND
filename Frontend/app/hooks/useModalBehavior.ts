"use client";

import { useEffect } from "react";

type UseModalBehaviorOptions = {
  isOpen: boolean;
  onClose: () => void;
  disabled?: boolean;
};

/**
 * 모달 공통 동작: ESC 키로 닫기 + body 스크롤 잠금
 */
export function useModalBehavior({
  isOpen,
  onClose,
  disabled = false,
}: UseModalBehaviorOptions) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !disabled) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose, disabled]);
}
