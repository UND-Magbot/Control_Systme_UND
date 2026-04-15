'use client';

/**
 * 하위 호환 래퍼: 기존 import 경로를 유지하면서 새 RemoteModal로 위임
 * 기존: import RemoteMapModal from "@/app/(pages)/operationManagement/components/tabs/robot/RemoteMapModal";
 * 새:   @/app/components/modal/remote/RemoteModal
 */
export { default } from '@/app/components/modal/remote/RemoteModal';
export type { RemoteModalProps } from '@/app/components/modal/remote/RemoteModal';
