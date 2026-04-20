'use client';

import styles from './ModuleManageModal.module.css';
import modalStyles from '@/app/components/modal/Modal.module.css';
import React, { useState, useEffect, useCallback } from 'react';
import type { RobotModule } from '@/app/types';
import { apiFetch } from '@/app/lib/api';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { Camera, Cog, GripVertical, Radar, Plus, ArrowLeft, X } from 'lucide-react';
import CustomSelect from '@/app/components/select/CustomSelect';
import type { SelectOption } from '@/app/components/select/CustomSelect';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  robotId: number;
  robotName: string;
  isAdmin?: boolean;
};

type FormData = {
  moduleType: string;
  label: string;
  parentModuleId: number | null;
  streamType: string;
  cameraIP: string;
  port: string;
  path: string;
};

const INITIAL_FORM: FormData = {
  moduleType: 'camera',
  label: '',
  parentModuleId: null,
  streamType: 'rtsp',
  cameraIP: '',
  port: '8554',
  path: '',
};

const TYPE_LABELS: Record<string, string> = {
  camera: '카메라',
  arm: '암',
  gripper: '그리퍼',
  sensor: '센서',
};

const TYPE_OPTIONS: SelectOption[] = [
  { id: 'camera', label: '카메라' },
  { id: 'arm', label: '암' },
  { id: 'gripper', label: '그리퍼' },
  { id: 'sensor', label: '센서' },
];

const PROTOCOL_OPTIONS: SelectOption[] = [
  { id: 'rtsp', label: 'RTSP' },
  { id: 'ws', label: 'WebSocket' },
];

function moduleTypeIcon(type: string, size = 20) {
  switch (type) {
    case 'camera': return <Camera size={size} />;
    case 'arm': return <Cog size={size} />;
    case 'gripper': return <GripVertical size={size} />;
    case 'sensor': return <Radar size={size} />;
    default: return <Cog size={size} />;
  }
}

function flattenTree(items: RobotModule[]): RobotModule[] {
  const result: RobotModule[] = [];
  for (const m of items) {
    result.push(m);
    if (m.children?.length) result.push(...flattenTree(m.children));
  }
  return result;
}

export default function ModuleManageModal({ isOpen, onClose, robotId, robotName, isAdmin = false }: Props) {
  const [modules, setModules] = useState<RobotModule[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // 뷰: list → detail(읽기) → edit(수정폼) / add(추가폼)
  const [view, setView] = useState<'list' | 'detail' | 'edit' | 'add'>('list');
  const [selectedModule, setSelectedModule] = useState<RobotModule | null>(null);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const fetchModules = useCallback(async () => {
    if (!robotId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await apiFetch(`/DB/robots/${robotId}/modules`);
      const data = res.ok ? await res.json() : { modules: [] };
      setModules(data.modules ?? []);
    } catch {
      setModules([]);
      setFetchError('모듈 정보를 불러오지 못했습니다');
    } finally {
      setLoading(false);
    }
  }, [robotId]);

  useEffect(() => {
    if (isOpen && robotId) {
      fetchModules();
      setView('list');
      setSelectedModule(null);
    }
  }, [isOpen, robotId, fetchModules]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'edit' || view === 'add') {
          // 수정/추가 폼 → 이전 뷰로
          if (view === 'edit' && selectedModule) {
            setView('detail');
          } else {
            setView('list');
          }
        } else if (view === 'detail') {
          setView('list');
          setSelectedModule(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, view, selectedModule]);

  if (!isOpen) return null;

  // ── 네비게이션 ──
  const goToList = () => {
    setView('list');
    setSelectedModule(null);
    setForm(INITIAL_FORM);
  };

  const goToDetail = (m: RobotModule) => {
    setView('detail');
    setSelectedModule(m);
  };

  const goToAdd = () => {
    setView('add');
    setSelectedModule(null);
    setForm(INITIAL_FORM);
  };

  const goToEdit = () => {
    if (!selectedModule) return;
    setView('edit');
    setForm({
      moduleType: selectedModule.type,
      label: selectedModule.label,
      parentModuleId: selectedModule.parentModuleId,
      streamType: (selectedModule.config?.streamType as string) ?? 'rtsp',
      cameraIP: (selectedModule.config?.cameraIP as string) ?? '',
      port: String(selectedModule.config?.port ?? '8554'),
      path: (selectedModule.config?.path as string) ?? '',
    });
  };

  // ── CRUD ──
  const handleAdd = async () => {
    if (!form.label.trim()) return;
    const payload: Record<string, unknown> = {
      moduleType: form.moduleType,
      label: form.label,
    };
    if (form.parentModuleId) payload.parentModuleId = form.parentModuleId;
    if (form.moduleType === 'camera') {
      payload.streamType = form.streamType;
      payload.port = parseInt(form.port) || 8554;
      payload.path = form.path || null;
      payload.cameraIP = form.cameraIP || null;
    }
    try {
      const res = await apiFetch(`/DB/robots/${robotId}/modules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await fetchModules();
        goToList();
      }
    } catch (err) {
      console.error('모듈 추가 실패:', err);
    }
  };

  const handleUpdate = async () => {
    if (!selectedModule || !form.label.trim()) return;
    const payload: Record<string, unknown> = { label: form.label };
    if (form.moduleType === 'camera') {
      payload.streamType = form.streamType;
      payload.port = parseInt(form.port) || 8554;
      payload.path = form.path || null;
      payload.cameraIP = form.cameraIP || null;
    }
    try {
      const res = await apiFetch(`/DB/modules/${selectedModule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await fetchModules();
        goToList();
      }
    } catch (err) {
      console.error('모듈 수정 실패:', err);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      const res = await apiFetch(`/DB/modules/${deleteConfirmId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchModules();
        goToList();
      }
    } catch (err) {
      console.error('모듈 삭제 실패:', err);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleToggleActive = async (e: React.MouseEvent, moduleId: number, currentActive: boolean) => {
    e.stopPropagation();
    try {
      await apiFetch(`/DB/modules/${moduleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: currentActive ? 0 : 1 }),
      });
      fetchModules();
    } catch (err) {
      console.error('토글 실패:', err);
    }
  };

  // ── 부모 후보 ──
  const getParentCandidates = (): RobotModule[] => {
    const all = flattenTree(modules);
    if (view === 'add') return all;
    const exclude = new Set<number>();
    const collectDescendants = (id: number) => {
      exclude.add(id);
      for (const m of all) {
        if (m.parentModuleId === id) collectDescendants(m.id);
      }
    };
    if (selectedModule) collectDescendants(selectedModule.id);
    return all.filter(m => !exclude.has(m.id));
  };

  const allModules = flattenTree(modules).sort((a, b) => a.id - b.id);

  // ── 헤더 타이틀 ──
  const headerTitle =
    view === 'add' ? '모듈 추가' :
    view === 'edit' ? '모듈 수정' :
    view === 'detail' ? '모듈 상세' :
    `${robotName} 모듈 관리`;

  // ── 뒤로가기 대상 ──
  const handleBack = () => {
    if (view === 'edit' && selectedModule) {
      // 수정 → 상세로 복귀
      setView('detail');
    } else if (view === 'detail') {
      goToList();
    } else {
      goToList();
    }
  };

  return (
    <div className={modalStyles.modalOverlay} onClick={onClose}>
      <div className={modalStyles.detailModalContent} onClick={e => e.stopPropagation()}>
        {/* ── 헤더 ── */}
        <div className={modalStyles.detailHeader}>
          <div className={modalStyles.detailHeaderTop}>
            <h2>
              {view !== 'list' && (
                <button className={styles.headerBackBtn} onClick={handleBack}>
                  <ArrowLeft size={18} />
                </button>
              )}
              {headerTitle}
            </h2>
            <button className={modalStyles.detailCloseBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── 바디 ── */}
        <div className={modalStyles.detailBody}>
          {loading ? (
            <div className={modalStyles.detailLoadingWrap}>
              <div className={modalStyles.detailSpinner} />
              <span>모듈 정보를 불러오는 중...</span>
            </div>
          ) : fetchError ? (
            <div className={modalStyles.detailErrorWrap}>
              <span>{fetchError}</span>
              <button
                className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgGray}`}
                onClick={fetchModules}
              >
                다시 시도
              </button>
            </div>
          ) : view === 'list' ? (
            /* ════════════════════════════════════
               목록 뷰 — 카드 그리드
               ════════════════════════════════════ */
            <div className={styles.cardGrid}>
              {isAdmin && (
                <button className={styles.addCard} onClick={goToAdd}>
                  <Plus size={18} /> 모듈 추가
                </button>
              )}
{allModules.map(m => (
                <div
                  key={m.id}
                  className={`${styles.moduleCard} ${!m.isActive ? styles.moduleCardInactive : ''}`}
                  onClick={() => goToDetail(m)}
                >
                  <div className={styles.cardRow}>
                    <div className={`${styles.moduleIconCircle} ${styles[m.type] ?? ''}`}>
                      {moduleTypeIcon(m.type)}
                    </div>
                    <div className={styles.cardLabelGroup}>
                      <span className={styles.cardLabel}>{m.label}</span>
                      <span className={styles.cardType}>{TYPE_LABELS[m.type] ?? m.type}</span>
                    </div>
                    <label className={styles.toggleSwitch} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={m.isActive}
                        onChange={() => {}}
                        onClick={e => handleToggleActive(e, m.id, m.isActive)}
                      />
                      <span className={styles.toggleSlider} />
                    </label>
                  </div>
                </div>
              ))}
            </div>

          ) : view === 'detail' && selectedModule ? (
            /* ════════════════════════════════════
               상세 뷰 — 읽기 전용
               ════════════════════════════════════ */
            <div>
              {/* 모듈 정보 카드 */}
              <div className={styles.detailCard}>
                {/* 헤더: 아이콘 + 이름만 */}
                <div className={styles.detailCardHeader}>
                  <div className={`${styles.moduleIconCircle} ${styles[selectedModule.type] ?? ''}`}>
                    {moduleTypeIcon(selectedModule.type, 24)}
                  </div>
                  <div className={styles.detailCardHeaderInfo}>
                    <div className={styles.detailCardName}>{selectedModule.label}</div>
                  </div>
                </div>

                {/* 정보 항목 */}
                <div className={styles.detailInfoGrid}>
                  {/* 1. 식별 */}
                  <div className={styles.detailInfoRow}>
                    <span className={styles.detailInfoLabel}>타입</span>
                    <span className={styles.detailInfoValue}>{TYPE_LABELS[selectedModule.type] ?? selectedModule.type}</span>
                  </div>
                  <div className={styles.detailInfoRow}>
                    <span className={styles.detailInfoLabel}>구분</span>
                    <span className={styles.detailInfoValue}>{selectedModule.isBuiltIn ? '내장' : '외장'}</span>
                  </div>

                  {/* 2. 연결 정보 (카메라) */}
                  {selectedModule.type === 'camera' && selectedModule.config && (
                    <>
                      <div className={styles.detailInfoRow}>
                        <span className={styles.detailInfoLabel}>IP</span>
                        <span className={styles.detailInfoValue}>
                          {String(selectedModule.config.cameraIP ?? '-')}
                        </span>
                      </div>
                      <div className={styles.detailInfoRow}>
                        <span className={styles.detailInfoLabel}>프로토콜</span>
                        <span className={styles.detailInfoValue}>
                          {((selectedModule.config.streamType as string) ?? 'rtsp').toUpperCase()}
                        </span>
                      </div>
                      <div className={styles.detailInfoRow}>
                        <span className={styles.detailInfoLabel}>포트</span>
                        <span className={styles.detailInfoValue}>
                          {String(selectedModule.config.port ?? '8554')}
                        </span>
                      </div>
                      <div className={styles.detailInfoRow}>
                        <span className={styles.detailInfoLabel}>경로</span>
                        <span className={styles.detailInfoValue}>
                          {selectedModule.config.path ? String(selectedModule.config.path) : '-'}
                        </span>
                      </div>
                    </>
                  )}

                  {/* 3. 부가 정보 */}
                  <div className={styles.detailInfoRow}>
                    <span className={styles.detailInfoLabel}>상태</span>
                    <span className={`${styles.detailInfoValue} ${selectedModule.isActive ? styles.valueActive : styles.valueInactive}`}>
                      {selectedModule.isActive ? '활성' : '비활성'}
                    </span>
                  </div>
                  <div className={styles.detailInfoRow}>
                    <span className={styles.detailInfoLabel}>등록일</span>
                    <span className={styles.detailInfoValue}>{selectedModule.createdAt ?? '-'}</span>
                  </div>
                </div>
              </div>

              {/* 하단 액션 버튼 */}
              {isAdmin && (
                <div className={styles.detailActions}>
                  <button
                    className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgGray}`}
                    onClick={goToEdit}
                  >
                    수정
                  </button>
                  {!selectedModule.isBuiltIn && (
                    <button
                      className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgRed}`}
                      onClick={() => setDeleteConfirmId(selectedModule.id)}
                    >
                      삭제
                    </button>
                  )}
                </div>
              )}
            </div>

          ) : (
            /* ════════════════════════════════════
               폼 뷰 — 추가 / 수정
               ════════════════════════════════════ */
            <div>
              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label>타입</label>
                  <CustomSelect
                    options={TYPE_OPTIONS}
                    value={TYPE_OPTIONS.find(o => o.id === form.moduleType) ?? null}
                    onChange={o => setForm(p => ({ ...p, moduleType: String(o.id) }))}
                    placeholder="타입 선택"
                    disabled={view === 'edit'}
                    overlay
                  />
                </div>

                <div className={styles.formRow}>
                  <label>라벨</label>
                  <input
                    type="text"
                    maxLength={50}
                    placeholder="예: 암 카메라"
                    value={form.label}
                    onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                  />
                </div>

                {view === 'add' && (
                  <div className={`${styles.formRow} ${styles.formRowFull}`}>
                    <label>부모 모듈</label>
                    <CustomSelect
                      options={[
                        { id: '', label: '없음 (최상위)' },
                        ...getParentCandidates().map(c => ({ id: c.id, label: `${c.label} (${TYPE_LABELS[c.type] ?? c.type})` })),
                      ]}
                      value={
                        form.parentModuleId
                          ? (() => { const c = getParentCandidates().find(m => m.id === form.parentModuleId); return c ? { id: c.id, label: `${c.label} (${TYPE_LABELS[c.type] ?? c.type})` } : null; })()
                          : { id: '', label: '없음 (최상위)' }
                      }
                      onChange={o => setForm(p => ({ ...p, parentModuleId: o.id ? Number(o.id) : null }))}
                      placeholder="부모 모듈 선택"
                      overlay
                    />
                  </div>
                )}

                {form.moduleType === 'camera' && (
                  <>
                    <div className={styles.formRow}>
                      <label>프로토콜</label>
                      <CustomSelect
                        options={PROTOCOL_OPTIONS}
                        value={PROTOCOL_OPTIONS.find(o => o.id === form.streamType) ?? null}
                        onChange={o => setForm(p => ({ ...p, streamType: String(o.id) }))}
                        placeholder="프로토콜 선택"
                        overlay
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>포트</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={5}
                        placeholder="8554"
                        value={form.port}
                        onChange={e => setForm(p => ({ ...p, port: e.target.value.replace(/\D/g, '') }))}
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>경로</label>
                      <input
                        type="text"
                        maxLength={100}
                        placeholder="/video3"
                        value={form.path}
                        onChange={e => setForm(p => ({ ...p, path: e.target.value }))}
                      />
                    </div>
                    <div className={styles.formRow}>
                      <label>IP</label>
                      <input
                        type="text"
                        maxLength={45}
                        placeholder="비워두면 로봇 IP 사용"
                        value={form.cameraIP}
                        onChange={e => setForm(p => ({ ...p, cameraIP: e.target.value }))}
                      />
                    </div>
                  </>
                )}

                {form.moduleType !== 'camera' && (
                  <div className={`${styles.formRow} ${styles.formRowFull}`}>
                    <div className={styles.formNoConfig}>설정 항목이 없습니다</div>
                  </div>
                )}
              </div>

              <div className={styles.formActionBar}>
                <button
                  className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgRed}`}
                  onClick={handleBack}
                >
                  취소
                </button>
                <button
                  className={`${modalStyles.btnItemCommon} ${modalStyles.btnBgBlue} ${!form.label.trim() ? modalStyles.btnDisabled : ''}`}
                  onClick={view === 'add' ? handleAdd : handleUpdate}
                  disabled={!form.label.trim()}
                >
                  {view === 'add' ? '추가' : '저장'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {deleteConfirmId !== null && (
        <CancelConfirmModal
          message="이 모듈을 삭제하시겠습니까?"
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
}
