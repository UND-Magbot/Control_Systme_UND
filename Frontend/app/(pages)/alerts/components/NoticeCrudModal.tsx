"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { AlertMockData, NoticeImportance } from '@/app/mock/alerts_data';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import styles from './NoticeCrudModal.module.css';

export type NoticeFormData = {
  title: string;
  content: string;
  importance: NoticeImportance;
  attachment: File | null;
};

type NoticeFormProps = {
  mode: 'create' | 'edit';
  initial?: AlertMockData | null;
  existingTitles?: string[]; // unused, kept for compatibility
  onClose: () => void;
  onSubmit: (data: NoticeFormData) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const importanceOptions: { value: NoticeImportance; label: string }[] = [
  { value: 'high', label: '중요' },
  { value: 'normal', label: '일반' },
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.hwp', '.txt', '.png', '.jpg', '.jpeg', '.gif'];
const ALLOWED_TYPES_DISPLAY = 'PDF, DOC, XLS, PPT, HWP, TXT, PNG, JPG, GIF';

type FieldErrors = {
  title?: string;
  content?: string;
};

export default function NoticeForm({ mode, initial, existingTitles, onClose, onSubmit, onDirtyChange }: NoticeFormProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState<NoticeImportance>('normal');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [existingAttachmentName, setExistingAttachmentName] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // 폼 초기화
  useEffect(() => {
    if (mode === 'edit' && initial) {
      setTitle(initial.title ?? initial.content ?? '');
      setContent(initial.detail ?? '');
      setImportance(initial.importance ?? 'normal');
      setAttachment(null);
      setExistingAttachmentName(initial.attachmentName ?? null);
    } else {
      setTitle('');
      setContent('');
      setImportance('normal');
      setAttachment(null);
      setExistingAttachmentName(null);
    }
    setErrors({});
    setFileError(null);
    setIsSubmitting(false);
    setShowSuccess(false);
    setShowConfirm(false);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }, [mode, initial]);

  // dirty 상태 계산 + 부모 알림
  const isDirty = useMemo(() => {
    if (mode === 'create') {
      return title !== '' || content !== '' || importance !== 'normal' || attachment !== null;
    }
    return title !== (initial?.title ?? initial?.content ?? '') ||
           content !== (initial?.detail ?? '') ||
           importance !== (initial?.importance ?? 'normal') ||
           attachment !== null;
  }, [title, content, importance, attachment, mode, initial]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const isFormValid = title.trim().length > 0 && content.trim().length > 0;

  const validate = (): boolean => {
    const newErrors: FieldErrors = {};
    if (!title.trim()) newErrors.title = '제목을 입력하세요';
    if (!content.trim()) newErrors.content = '내용을 입력하세요';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    if (!validate()) return;
    setIsSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), content: content.trim(), importance, attachment });
      setShowSuccess(true);
      setTimeout(() => onClose(), 800);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '등록에 실패했습니다';
      setErrors(prev => ({ ...prev, title: message }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isDirty) { setShowConfirm(true); return; }
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file) {
      if (file.size > MAX_FILE_SIZE) {
        setFileError('파일 크기는 10MB 이하만 가능합니다');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        setFileError('허용되지 않는 파일 형식입니다');
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setFileError(null);
    }
    setAttachment(file);
    if (file) setExistingAttachmentName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveFile = () => {
    setAttachment(null);
    setExistingAttachmentName(null);
    setFileError(null);
  };

  const displayFileName = attachment?.name ?? existingAttachmentName ?? null;

  return (
    <div className={styles.formWrapper}>
      {/* 성공 오버레이 */}
      {showSuccess && (
        <div className={styles.successOverlay}>
          <span className={styles.successIcon}>✓</span>
          <span className={styles.successText}>{mode === 'create' ? '등록 완료' : '수정 완료'}</span>
        </div>
      )}

      {/* 헤더 */}
      <div className={styles.header}>
        <h2 className={styles.headerTitle}>
          {mode === 'create' ? '공지사항 등록' : '공지사항 수정'}
        </h2>
      </div>

      {/* 본문 */}
      <div className={styles.body}>
        {/* 제목 */}
        <div className={styles.fieldGroup}>
          <div className={styles.fieldLabelRow}>
            <label className={styles.fieldLabel}>
              제목<span className={styles.fieldRequired}>*</span>
            </label>
            <span className={`${styles.charCount} ${title.length > 90 ? styles.charCountWarn : ''}`}>
              {title.length}/100
            </span>
          </div>
          <input
            ref={titleInputRef}
            type="text"
            className={`${styles.fieldInput} ${errors.title ? styles.fieldInputError : ''}`}
            placeholder="공지사항 제목을 입력하세요"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setErrors(prev => ({ ...prev, title: undefined })); }}
            maxLength={100}
          />
          {errors.title && <span className={styles.fieldError}>{errors.title}</span>}
        </div>

        {/* 중요도 (라디오 - 라벨 옆 인라인) */}
        <div className={styles.importanceRow}>
          <label className={styles.fieldLabel}>중요도</label>
          <span className={styles.importanceDivider} />
          <div className={styles.importanceGroup}>
            {importanceOptions.map(opt => (
              <label
                key={opt.value}
                className={`${styles.radioLabel} ${
                  opt.value === 'high' ? styles.radioHigh : styles.radioNormal
                } ${importance === opt.value ? styles.radioActive : ''}`}
              >
                <span className={styles.radioCircle}>
                  {importance === opt.value && <span className={styles.radioDot} />}
                </span>
                <span>{opt.label}</span>
                <input
                  type="radio"
                  name="importance"
                  value={opt.value}
                  checked={importance === opt.value}
                  onChange={() => setImportance(opt.value)}
                  className={styles.radioInput}
                />
              </label>
            ))}
          </div>
        </div>

        {/* 내용 */}
        <div className={`${styles.fieldGroup} ${styles.fieldGroupExpand}`}>
          <div className={styles.fieldLabelRow}>
            <label className={styles.fieldLabel}>
              내용<span className={styles.fieldRequired}>*</span>
            </label>
            <span className={`${styles.charCount} ${content.length > 1800 ? styles.charCountWarn : ''}`}>
              {content.length}/2000
            </span>
          </div>
          <textarea
            className={`${styles.contentTextarea} ${errors.content ? styles.fieldInputError : ''}`}
            placeholder="공지사항 내용을 입력하세요"
            value={content}
            onChange={(e) => { setContent(e.target.value); setErrors(prev => ({ ...prev, content: undefined })); }}
            maxLength={2000}
          />
          {errors.content && <span className={styles.fieldError}>{errors.content}</span>}
        </div>

        {/* 파일 첨부 */}
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel}>파일 첨부</label>
          <div className={styles.attachRow}>
            <div className={styles.attachDisplay}>
              {displayFileName ? (
                <>
                  <span className={styles.attachFileName}>{displayFileName}</span>
                  <button type="button" className={styles.attachRemoveBtn} onClick={handleRemoveFile}>
                    ✕
                  </button>
                </>
              ) : (
                <span>선택된 파일 없음</span>
              )}
            </div>
            <button
              type="button"
              className={styles.attachBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              추가
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_EXTENSIONS.join(',')}
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
          <span className={styles.attachHint}>1개 첨부 가능 · 최대 10MB · {ALLOWED_TYPES_DISPLAY}</span>
          {fileError && <span className={styles.fieldError}>{fileError}</span>}
        </div>
      </div>

      {/* 푸터 */}
      <div className={styles.footer}>
        <button type="button" className={styles.cancelBtn} onClick={handleClose}>
          취소
        </button>
        <button
          type="button"
          className={`${styles.submitBtn} ${(!isFormValid || isSubmitting) ? styles.submitBtnDisabled : ''}`}
          onClick={handleSubmit}
          disabled={!isFormValid || isSubmitting}
        >
          {isSubmitting ? '처리 중...' : mode === 'create' ? '등록' : '수정'}
        </button>
      </div>

      {/* 미저장 확인 모달 */}
      {showConfirm && (
        <CancelConfirmModal
          message="작성 중인 내용이 있습니다. 닫으시겠습니까?"
          onConfirm={onClose}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
