// 흐름: 장소 리스트 클릭 → selectedPlaceId state 저장 → img 경로 자동 변경 → 확인 버튼 클릭 → 선택값 검증 → 로봇 이동 이벤트 실행
'use client';

import styles from './Modal.module.css';
import React, { useEffect, useRef, useState } from 'react';
import type { RobotRowData } from '@/app/type';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import { mockPlaces } from '@/app/mock/place_data';


type WorkModalProps = {
    isOpen: boolean;
    onClose: () => void;
    selectedRobotIds: number[];
    // selectedRobotId: number | null;
    // selectedRobot: RobotRowData | null;
    // robots: RobotRowData[];   
}

type Place = {
  id: number;
  name: string;
  // 추후 좌표, 노드ID, 맵ID 등 확장 가능
  x?: number;
  y?: number;
};

export default function RobotDetailModal({
    isOpen,
    onClose,
    // selectedRobotId,
    // selectedRobot,
    // robots
}:WorkModalProps ){


    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

    const [selectedPlaceId, setSelectedPlaceId] = useState<number | null>(null);

    // ESC 키로 모달 닫기
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        
        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden'; // 스크롤 방지
        }
        
        return () => {
            document.removeEventListener('keydown', handleEscape);
            document.body.style.overflow = 'unset';
        };
    }, [isOpen, onClose]);

    const handleCancel = () => {
        onClose();
    };
    
    const handleOk = () => {
        if (selectedPlaceId === null) {
            alert("이동할 장소를 선택해 주세요.");
            return;
        }

        const selectedPlace = mockPlaces.find(
            (p) => p.id === selectedPlaceId
        );

        if (!selectedPlace) return;

            console.log("로봇 이동 시작 → 장소:", selectedPlace);
            
            // 실제 로봇 이동 명령 수행 로직

            onClose();
    };

    //선택된 장소 id 저장
    const handleSelectPlace = (placeId: number) => {
        setSelectedPlaceId(placeId);
    };

    useEffect(() => {
      if (isOpen) setSelectedPlaceId(null);
    }, [isOpen]);

    useCustomScrollbar({
        enabled: isOpen,
        scrollRef,
        trackRef,
        thumbRef,
        minThumbHeight: 50,
        deps: [mockPlaces.length],
    });

    if (!isOpen) return null;

    return (
        <>
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.placePathModalContent} onClick={(e) => e.stopPropagation()}>
                <button className={styles.placeCloseBtn} onClick={onClose}>✕</button>
                <div className={styles.placeTitle}>
                    아래 이동할 장소를 먼저 선택해 주세요.
                </div>

                <div className={styles.placePathBox}>
                    <div ref={scrollRef} className={styles.placeInner} role="listbox">
                        {mockPlaces.map((place) => {
                            const isSelected = selectedPlaceId === place.id;

                            return (
                                <div
                                key={place.id}
                                className={`${styles.placePathItem} ${isSelected ? styles.active : ""}`}
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => handleSelectPlace(place.id)}
                                >
                                <img
                                    src={isSelected ? "/icon/place_chk.png" : "/icon/place_none_chk.png"}
                                    alt=""
                                />
                                <div className={styles.placePathTitle}>{place.name}</div>
                                </div>
                            );
                        })}
                        <div ref={trackRef} className={styles.placeScrollTrack}>
                            <div ref={thumbRef} className={styles.placeScrollThumb} />
                        </div>
                    </div>
                </div>

                <div className={styles.workBtnBox}>
                    <button className={`${styles.workBtnCommon} ${styles.workBtnBgRed}`} onClick={handleCancel} >
                        <img src="/icon/close_btn.png" alt="cancel"/>
                        <div>취소</div>
                    </button>
                    <button className={`${styles.workBtnCommon} ${styles.workBtnBgBlue}`}  onClick={handleOk}>
                        <img src="/icon/check.png" alt="save" />
                        <div>확인</div>
                    </button>
                </div>
            </div>
        </div>
        </>
    );
    
}