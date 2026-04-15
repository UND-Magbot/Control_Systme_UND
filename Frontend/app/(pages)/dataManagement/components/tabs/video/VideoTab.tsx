"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import styles from '../../DataManagementTabs.module.css';
import Pagination from "@/app/components/common/Pagination";
import { usePaginatedList } from "@/app/hooks/usePaginatedList";
import BaseCalendar from "@/app/components/calendar/BaseCalendar";
import { formatDateToYMD, parseYMD } from "@/app/components/calendar/index";
import { useOutsideClick } from "@/app/hooks/useOutsideClick";
import type { RobotRowData, Video, VideoItem, Period } from "@/app/types";
import VideoPlayModal from "./VideoPlayModal";
import CancelConfirmModal from "@/app/components/modal/CancelConfirmModal";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import { apiFetch } from "@/app/lib/api";
import { PAGE_SIZE } from '../../../constants';
import { useVideoFetch } from "../../../hooks/useVideoFetch";
import { periodFormatDate, formatVideoTime, videoFormatDate } from "../../../utils/videoHelpers";

type Props = {
  video: Video[];
  robots: RobotRowData[];
  onLoaded?: () => void;
};

export default function VideoTab({ video, robots, onLoaded }: Props) {
  // ── 필터 상태 ──
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>("today");

  // ── 날짜 범위 ──
  const todayStr = useMemo(() => formatDateToYMD(new Date()), []);
  const [videoStartDate, setVideoStartDate] = useState(todayStr);
  const [videoEndDate, setVideoEndDate] = useState(todayStr);
  const [videoCalendarOpen, setVideoCalendarOpen] = useState(false);
  const [videoActiveField, setVideoActiveField] = useState<"start" | "end" | null>(null);
  const videoCalendarRef = useRef<HTMLDivElement>(null);
  useOutsideClick(
    videoCalendarRef,
    useCallback(() => { setVideoCalendarOpen(false); setVideoActiveField(null); }, []),
  );

  // ── 가장 이른 녹화 날짜 (1회 조회) ──
  const [videoEarliestDate, setVideoEarliestDate] = useState<string | null>(null);
  useEffect(() => {
    apiFetch("/api/recordings/earliest-date")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data?.earliest_date) setVideoEarliestDate(data.earliest_date); })
      .catch(() => {});
  }, []);

  // ── 데이터 fetch ──
  const [videoData, setVideoData] = useVideoFetch({
    enabled: true,
    robots,
    selectedRobot,
    selectedVideo,
    startDate: videoStartDate,
    endDate: videoEndDate,
    onLoaded,
  });

  // ── 페이지네이션 ──
  const videoPagination = usePaginatedList(videoData, {
    pageSize: PAGE_SIZE,
    resetDeps: [selectedVideo, selectedRobot, videoStartDate, videoEndDate],
  });
  const videoCurrentItems = videoPagination.pagedItems as VideoItem[];

  // ── 플레이어 모달 ──
  const [videoPlayModalOpen, setVideoPlayModalOpen] = useState(false);
  const [playedVideo, setPlayedVideo] = useState<VideoItem | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // ── 선택 삭제 모드 ──
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [, setIsDeleting] = useState(false);

  // ── 기간 버튼 처리 ──
  const handlePeriodClick = async (period: Period | null) => {
    setSelectedPeriod(period);
    const today = new Date();

    if (period === "Total") {
      let earliest = videoEarliestDate;
      if (!earliest) {
        try {
          const res = await apiFetch("/api/recordings/earliest-date");
          if (res.ok) {
            const data = await res.json();
            if (data?.earliest_date) {
              earliest = data.earliest_date;
              setVideoEarliestDate(earliest);
            }
          }
        } catch {}
      }
      setVideoStartDate(earliest ?? periodFormatDate(today));
      setVideoEndDate(periodFormatDate(today));
      return;
    }

    const start = new Date(today);
    if (period === "today") { /* start = today */ }
    else if (period === "3days") start.setDate(start.getDate() - 3);
    else if (period === "1week") start.setDate(start.getDate() - 7);

    setVideoStartDate(periodFormatDate(start));
    setVideoEndDate(periodFormatDate(today));
  };

  // ── 영상 클릭 → 모달 ──
  const handleVideoPlayClick = (_idx: number, videoItem: VideoItem) => {
    setPlayedVideo(videoItem);
    setVideoPlayModalOpen(true);
  };

  // ── 선택 삭제 ──
  const toggleSelectMode = () => {
    if (selectMode) setSelectedIds(new Set());
    setSelectMode(!selectMode);
  };

  const toggleSelect = (groupId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    setIsDeleting(true);
    try {
      const res = await apiFetch("/api/recordings/delete-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_ids: Array.from(selectedIds) }),
      });
      if (res.ok) {
        setVideoData(videoData.filter((v) => !selectedIds.has(v.group_id || String(v.id))));
        setSelectedIds(new Set());
        setSelectMode(false);
      }
    } catch (e) {
      console.error("[VideoTab] 삭제 실패:", e);
    } finally {
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  // ── 다운로드 ──
  const downloadVideo = async (videoItem: VideoItem) => {
    if (!videoItem.id) return;
    const dateStr = videoItem.record_start
      ? new Date(videoItem.record_start).toISOString().replace(/[-:T]/g, "").slice(0, 15)
      : "unknown";
    const filename = `${videoItem.robotNo}_${videoItem.cameraNo}_${videoItem.record_type || ""}_${dateStr}.mp4`;

    try {
      const res = await apiFetch(`/api/recordings/download/${videoItem.id}?filename=${encodeURIComponent(filename)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[VideoTab] 다운로드 실패:", e);
    }
  };

  return (
    <div className={styles.videoList}>
      <div className={styles.videoListTopPosition}>
        <h2>영상 관리</h2>
        <div className={styles.videoSearch}>
          <div className={styles.videoSelect}>
            <FilterSelectBox
              items={video.map((v) => ({ id: v.id, label: v.label }))}
              selectedLabel={selectedVideo?.label ?? null}
              placeholder="녹화 타입"
              showTotal={true}
              onSelect={(item) => {
                if (item) {
                  const found = video.find((v) => v.label === item.label);
                  if (found) setSelectedVideo(found);
                } else {
                  setSelectedVideo(null);
                }
              }}
            />
            <FilterSelectBox
              items={robots.map((r) => ({ id: r.id, label: r.no }))}
              selectedLabel={selectedRobot?.no ?? null}
              placeholder="로봇 명"
              showTotal={robots.length > 0}
              onSelect={(item) => {
                if (item) {
                  const robot = robots.find((r) => r.no === item.label);
                  if (robot) setSelectedRobot(robot);
                } else {
                  setSelectedRobot(null);
                }
              }}
            />
          </div>
          <div className={styles.videoPeriod}>
            {(
              [
                { key: "Total", label: "전체" },
                { key: "today", label: "당일" },
                { key: "3days", label: "3일" },
                { key: "1week", label: "1주" },
              ] as const
            ).map(({ key, label }) => (
              <div
                key={key}
                className={`${styles.periodItem} ${selectedPeriod === key ? styles.active : ""}`}
                onClick={() => handlePeriodClick(key)}
              >
                {label}
              </div>
            ))}
          </div>
          <div ref={videoCalendarRef} className={styles.dtDateRange}>
            <div
              className={`${styles.dtDateInput} ${videoActiveField === "start" && videoCalendarOpen ? styles.active : ""}`}
              onClick={() => { setVideoActiveField("start"); setVideoCalendarOpen(true); }}
            >
              <div>{videoStartDate}</div>
              <img src="/icon/search_calendar.png" alt="calendar" />
            </div>
            <div className={styles.dtDateSep}>~</div>
            <div
              className={`${styles.dtDateInput} ${videoActiveField === "end" && videoCalendarOpen ? styles.active : ""}`}
              onClick={() => { setVideoActiveField("end"); setVideoCalendarOpen(true); }}
            >
              <div>{videoEndDate}</div>
              <img src="/icon/search_calendar.png" alt="calendar" />
            </div>
            {videoCalendarOpen && videoActiveField && (
              <div className={styles.dtCalendarDropdown}>
                <BaseCalendar
                  mode="range"
                  startDate={videoStartDate}
                  endDate={videoEndDate}
                  activeField={videoActiveField}
                  onRangeSelect={(field, date) => {
                    if (field === "start") {
                      setVideoStartDate(date);
                      if (date > videoEndDate) setVideoEndDate(date);
                      setVideoActiveField("end");
                    } else {
                      setVideoEndDate(date);
                      if (date < videoStartDate) setVideoStartDate(date);
                      setVideoCalendarOpen(false);
                      setVideoActiveField(null);
                    }
                    setSelectedPeriod(null);
                  }}
                  showTodayButton
                  maxDate={periodFormatDate(new Date())}
                  initialViewDate={videoActiveField === "start" ? parseYMD(videoStartDate) : parseYMD(videoEndDate)}
                />
              </div>
            )}
          </div>
          <div className={styles.videoDeleteArea}>
            {!selectMode ? (
              <div className={styles.videoWorkBtn} onClick={toggleSelectMode}>
                <img src="/icon/delete_icon.png" alt="delete" />
                삭제
              </div>
            ) : (
              <>
                <div
                  className={`${styles.videoDeleteConfirmBtn} ${selectedIds.size === 0 ? styles.btnDisabled : ""}`}
                  onClick={() => { if (selectedIds.size > 0) setDeleteConfirmOpen(true); }}
                >
                  <img src="/icon/delete_icon.png" alt="" />
                  <span>삭제 확인 ({selectedIds.size})</span>
                </div>
                <div className={styles.videoWorkBtn} onClick={toggleSelectMode}>취소</div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={styles.contentArea}>
        {videoCurrentItems.length === 0 ? (
          <div className={styles.emptyState}>
            <span>조건에 맞는 영상이 없습니다</span>
          </div>
        ) : (
          <div className={styles.videoViewContainer}>
            {videoCurrentItems.map((r, idx) => {
              const itemKey = r.group_id || String(r.id);
              return (
                <div
                  key={itemKey}
                  className={`${styles.videoViewItem} ${selectMode && selectedIds.has(itemKey) ? styles.videoViewItemSelected : ""}`}
                >
                  <div
                    className={styles.videoViewBox}
                    onClick={() => {
                      if (selectMode) toggleSelect(itemKey);
                      else handleVideoPlayClick(idx, r);
                    }}
                  >
                    <div className={styles.videoView}>
                      {r.thumbnail_url ? (
                        <img
                          src={r.thumbnail_url}
                          alt="thumbnail"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                            (e.target as HTMLImageElement).nextElementSibling?.classList.remove(styles.hidden);
                          }}
                        />
                      ) : null}
                      <div className={`${styles.thumbPlaceholder} ${r.thumbnail_url ? styles.hidden : ""}`}>
                        <img src="/icon/video_icon.png" alt="" />
                        <span>{r.cameraNo || "카메라"}</span>
                      </div>
                    </div>
                    <div
                      className={styles.videoViewIcon}
                      onMouseEnter={() => setHoveredIndex(idx)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    >
                      <img
                        src={hoveredIndex === idx ? `/icon/video_hover_icon.png` : `/icon/video_icon.png`}
                        alt="play"
                      />
                    </div>
                  </div>
                  <div className={styles.videoMeta}>
                    <div className={styles.metaRow1}>
                      <span className={styles.metaPrimary}>{r.robotNo} · {r.cameraNo}</span>
                      <div
                        className={styles.videoExport}
                        onClick={(e) => { e.stopPropagation(); downloadVideo(r); }}
                      >
                        <img src="/icon/download.png" alt="download" />
                        <span>다운로드</span>
                      </div>
                    </div>
                    <div className={styles.metaRow2}>
                      <span className={styles.metaType}>
                        <span className={styles.cameratypeIcon}></span>
                        {r.work_name || r.cameraType}
                      </span>
                      <span className={styles.metaDot}>·</span>
                      <span>{videoFormatDate(r.date)}</span>
                      <span className={styles.metaDot}>·</span>
                      <span className={styles.metaAccent}>{formatVideoTime(r.videoTime)}</span>
                      {r.segment_count && r.segment_count > 1 && (
                        <>
                          <span className={styles.metaDot}>·</span>
                          <span>{r.segment_count}개 세그먼트</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.pagenationPosition}>
        <Pagination
          totalItems={videoPagination.totalItems}
          currentPage={videoPagination.currentPage}
          onPageChange={videoPagination.setPage}
          pageSize={PAGE_SIZE}
          blockSize={5}
        />
      </div>

      <VideoPlayModal
        isOpen={videoPlayModalOpen}
        onClose={() => setVideoPlayModalOpen(false)}
        playedVideo={playedVideo}
      />
      {deleteConfirmOpen && (
        <CancelConfirmModal
          message={`선택한 영상 ${selectedIds.size}건을 삭제하시겠습니까?`}
          onConfirm={handleDeleteSelected}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}
