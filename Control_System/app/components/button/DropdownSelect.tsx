'use client';

import React, { useState, useRef, useCallback } from 'react';
import styles from './DropdownSelect.module.css';
import { useOutsideClick } from '@/app/hooks/useOutsideClick';

type DropdownSelectProps<T> = {
  placeholder: string;
  value: T | null;
  options: T[];
  getLabel: (item: T) => string;
  getKey: (item: T) => string | number;
  onChange: (item: T) => void;
  compact?: boolean;
  disabled?: boolean;
  emptyMessage?: React.ReactNode;
  className?: string;
};

export default function DropdownSelect<T>({
  placeholder,
  value,
  options,
  getLabel,
  getKey,
  onChange,
  compact = false,
  disabled = false,
  emptyMessage,
  className,
}: DropdownSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useOutsideClick(wrapperRef, useCallback(() => setIsOpen(false), []));

  return (
    <div ref={wrapperRef} className={`${styles.wrapper} ${compact ? styles.compact : ''} ${disabled ? styles.disabled : ''} ${className ?? ''}`}>
      <div
        className={styles.trigger}
        onClick={() => { if (!disabled) setIsOpen((v) => !v); }}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        <span className={value ? styles.selectedText : styles.placeholderText}>
          {value ? getLabel(value) : placeholder}
        </span>
        {!disabled && (
          <img
            src={isOpen ? '/icon/arrow_up.png' : '/icon/arrow_down.png'}
            alt=""
            className={styles.arrow}
          />
        )}
      </div>

      {isOpen && !disabled && (
        <div className={styles.menu}>
          <div className={styles.menuInner} role="listbox">
            {options.length === 0 && emptyMessage ? (
              <div className={styles.emptyMessage}>{emptyMessage}</div>
            ) : (
              options.map((opt) => {
                const key = getKey(opt);
                const isActive = value !== null && getKey(value) === key;
                return (
                  <div
                    key={key}
                    className={`${styles.option} ${isActive ? styles.optionActive : ''}`}
                    onClick={() => {
                      onChange(opt);
                      setIsOpen(false);
                    }}
                    role="option"
                    aria-selected={isActive}
                  >
                    {getLabel(opt)}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
