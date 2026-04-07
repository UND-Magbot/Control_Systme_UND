// 흐름: 장소 리스트 클릭 → selectedPlaceId state 저장 → img 경로 자동 변경 → 확인 버튼 클릭 → 선택값 검증 → 로봇 이동 이벤트 실행
'use client';

import styles from './Modal.module.css';
import React, { useEffect, useRef, useState } from 'react';
import type { RobotRowData } from '@/app/type';
import { useCustomScrollbar } from "@/app/hooks/useCustomScrollbar";
import { useModalBehavior } from '@/app/hooks/useModalBehavior';
import { apiFetch } from "@/app/lib/api";


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
  x?: number;
  y?: number;
};

type DBPlace = {
  id: number;
  LacationName: string;
  Floor: string;
  LocationX: number;
  LocationY: number;
  Yaw: number;
  RobotName: string;
};

export default function RobotDetailModal({
    isOpen,
    onClose,
}:WorkModalProps ){


    const scrollRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);

    const [selectedPlaceId, setSelectedPlaceId] = useState<number | null>(null);
    const [places, setPlaces] = useState<Place[]>([]);
    const [loading, setLoading] = useState(false);

    useModalBehavior({ isOpen, onClose });

    const handleCancel = () => {
        onClose();
    };

    const handleOk = async () => {
        if (selectedPlaceId === null) return;

        const selectedPlace = places.find(
            (p) => p.id === selectedPlaceId
        );

        if (!selectedPlace) return;

        try {
            const res = await apiFetch(`/nav/placemove/${selectedPlaceId}`, {
                method: "POST",
            });
            const data = await res.json();
            console.log("장소 이동 명령 전송:", data.msg ?? data.status);
        } catch (err) {
            console.error("장소 이동 실패:", err);
        }

        onClose();
    };

    //선택된 장소 id 저장
    const handleSelectPlace = (placeId: number) => {
        setSelectedPlaceId(placeId);
    };

    // 모달 열릴 때 장소 목록 DB에서 가져오기
    useEffect(() => {
      if (isOpen) {
        setSelectedPlaceId(null);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;

        setLoading(true);
        apiFetch(`/DB/places`)
          .then((res) => res.json())
          .then((data: DBPlace[]) => {
            setPlaces(
              data.map((p) => ({
                id: p.id,
                name: p.LacationName,
                x: p.LocationX,
                y: p.LocationY,
              }))
            );
          })
          .catch((err) => {
            console.error("장소 목록 조회 실패:", err);
            setPlaces([]);
          })
          .finally(() => setLoading(false));
      }
    }, [isOpen]);

    useCustomScrollbar({
        enabled: isOpen,
        scrollRef,
        trackRef,
        thumbRef,
        minThumbHeight: 50,
        deps: [places.length],
    });

    if (!isOpen) return null;

    return (
        <>
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.placePathModalContent} onClick={(e) => e.stopPropagation()}>
                <button className={styles.placeCloseBtn} onClick={onClose}>✕</button>
                <div className={styles.placeModalHeader}>
                    <img src="/icon/robot_place_w.png" alt="" />
                    <h2>장소 이동</h2>
                </div>
                <div className={styles.placeTitle}>
                    아래 이동할 장소를 먼저 선택해 주세요.
                </div>

                <div className={styles.placePathBox}>
                    {loading ? (
                        <div className={styles.placeEmpty}>불러오는 중...</div>
                    ) : places.length === 0 ? (
                        <div className={styles.placeEmpty}>등록된 장소가 없습니다.</div>
                    ) : (
                        <>
                            <div ref={scrollRef} className={styles.placeInner} role="listbox">
                                {places.map((place) => {
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
                            </div>
                        </>
                    )}
                    <div ref={trackRef} className={styles.placeScrollTrack}>
                        <div ref={thumbRef} className={styles.placeScrollThumb} />
                    </div>
                </div>

                <div className={styles.workBtnBox}>
                    <button className={`${styles.workBtnCommon} ${styles.workBtnBgRed}`} onClick={handleCancel}>
                        <img src="/icon/close_btn.png" alt="" />
                        취소
                    </button>
                    <button
                        className={`${styles.workBtnCommon} ${styles.workBtnBgBlue} ${selectedPlaceId === null ? styles.workBtnDisabled : ""}`}
                        onClick={handleOk}
                    >
                        <img src="/icon/check.png" alt="" />
                        확인
                    </button>
                </div>
            </div>
        </div>
        </>
    );
    
}