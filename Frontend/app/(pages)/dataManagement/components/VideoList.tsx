"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import styles from './VideoList.module.css';
import Pagination from "@/app/components/pagination";
import { usePaginatedList } from "@/app/hooks/usePaginatedList";
import BaseCalendar from "@/app/components/calendar/BaseCalendar";
import { formatDateToYMD, parseYMD } from "@/app/components/calendar/index";
import { useOutsideClick } from "@/app/hooks/useOutsideClick";
import type { RobotRowData, Camera, Video, VideoItem, Period, LogItem, RobotType } from '@/app/type';
import VideoPlayModal from '@/app/components/modal/VideoPlayModal';
import CancelConfirmModal from '@/app/components/modal/CancelConfirmModal';
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";
import { apiFetch } from "@/app/lib/api";
import HorizontalBarChart from "./HorizontalBarChart";
import {
  buildRobotTypeBarFromApi,
  buildTaskBarFromApi,
  buildTimeBarFromApi,
  buildErrorBarFromApi,
} from '../../../utils/Charts';
import LogList from "./LogList";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";
import { useRobotStatusContext } from "@/app/context/RobotStatusContext";
import { getStatistics } from "@/app/lib/statisticsApi";
import type { StatisticsResponse, StatisticsResult } from "@/app/lib/statisticsApi";
import { getLogData } from "@/app/lib/logData";

const PAGE_SIZE = 8;

type VideoListProps = {
  cameras: Camera[];
  video: Video[];
  videoData: VideoItem[];
  robotTypeData: RobotType[];
  onDataReady?: () => void;
  initialTab?: "video" | "dt" | "log";
  initialSearch?: string;
}


export default function VideoList({
    videoData,
    video,
    robotTypeData,
    onDataReady,
    initialTab,
    initialSearch,
}:VideoListProps) {

    const { robots } = useRobotStatusContext();
    const [logData, setLogData] = useState<LogItem[]>([]);
    const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
    const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);

    useEffect(() => {
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
        getLogData({ start_date: todayStr, end_date: todayStr }).then((res) => setLogData(res.items));
    }, []);
    const [selectedPeriod, setSelectedPeriod] = useState<Period | null>("today");

    // 영상 탭 날짜 상태 (Calendar 컴포넌트 대체)
    const todayStr = useMemo(() => { const d = new Date(); return formatDateToYMD(d); }, []);
    const [videoStartDate, setVideoStartDate] = useState(todayStr);
    const [videoEndDate, setVideoEndDate] = useState(todayStr);
    const [videoCalendarOpen, setVideoCalendarOpen] = useState(false);
    const [videoActiveField, setVideoActiveField] = useState<"start" | "end" | null>(null);
    const videoCalendarRef = useRef<HTMLDivElement>(null);
    useOutsideClick(videoCalendarRef, useCallback(() => { setVideoCalendarOpen(false); setVideoActiveField(null); }, []));

    // 선택된 로봇 타입 (Total Robots = null)
    const [selectedRobotType, setSelectedRobotType] = useState<RobotType | null>(null);

    // 필터링된 영상 데이터 (useEffect에서 자동 관리)
    const [searchFilterData, setSearchFilterData] = useState<VideoItem[] | null>(null);

    const [videoPlayModalOpen, setVideoPlayModalOpen] = useState(false);
    const [playedVideoId, setPlayedVideoId] = useState<number | null>(null);
    const [playedVideo, setPlayedVideo] = useState<VideoItem | null>(null);
    const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);

    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<"video" | "dt" | "log">(initialTab || "video");

    // ── 선택 삭제 모드 ──
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // ── 통계 API 상태 ──
    const [statsData, setStatsData] = useState<StatisticsResponse | null>(null);

    // 통계 탭 전용 날짜 필터 (당일 기본값 — 영상 탭과 동일)
    const todayInit = (() => { const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0"); const dd = String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dd}`; })();
    const [dtStartDate, setDtStartDate] = useState<string | null>(todayInit);
    const [dtEndDate, setDtEndDate] = useState<string | null>(todayInit);
    const [dtPeriod, setDtPeriod] = useState<Period | null>("today");

    // 가장 이른 데이터 날짜 (마운트 시 1회 조회, "전체" 즉시 반영용)
    const [dtEarliestDate, setDtEarliestDate] = useState<string | null>(null);
    useEffect(() => {
        apiFetch("/DB/statistics/earliest-date")
            .then((res) => res.ok ? res.json() : null)
            .then((data) => { if (data?.earliest_date) setDtEarliestDate(data.earliest_date); })
            .catch(() => {});
    }, []);

    // 통계 탭 달력
    const [dtCalendarOpen, setDtCalendarOpen] = useState(false);
    const [dtActiveField, setDtActiveField] = useState<"start" | "end">("start");
    const dtCalendarRef = useRef<HTMLDivElement>(null);
    useOutsideClick(dtCalendarRef, useCallback(() => setDtCalendarOpen(false), []));

    // 영상 탭: 비디오 타입/로봇/날짜 범위 클라이언트 필터링 (Calendar 컴포넌트에서 이관)
    useEffect(() => {
        const baseFiltered = videoData.filter((item) => {
            const matchVideo = selectedVideo ? item.cameraType === selectedVideo.label : true;
            const matchRobot = selectedRobot ? item.robotNo === selectedRobot.no : true;
            return matchVideo && matchRobot;
        });

        if (!videoStartDate || !videoEndDate) {
            setSearchFilterData(baseFiltered);
            return;
        }

        const filtered = baseFiltered.filter((item) => {
            const itemDate = new Date(item.date);
            if (isNaN(itemDate.getTime())) return false;
            let start = new Date(videoStartDate);
            let end = new Date(videoEndDate);
            if (start > end) { const tmp = start; start = end; end = tmp; }
            end.setHours(23, 59, 59, 999);
            return itemDate >= start && itemDate <= end;
        });

        setSearchFilterData(filtered);
    }, [videoData, selectedVideo, selectedRobot, videoStartDate, videoEndDate]);

    // 탭별 데이터
    const videoItems = useMemo(() => searchFilterData === null ? videoData : searchFilterData, [searchFilterData, videoData]);

    // 탭별 페이지네이션
    const videoPagination = usePaginatedList(videoItems, {
      pageSize: PAGE_SIZE,
      resetDeps: [selectedVideo, selectedRobot, searchFilterData],
    });
    const dtPagination = usePaginatedList(robots, {
      pageSize: PAGE_SIZE,
      resetDeps: [selectedRobotType],
    });

    // 현재 탭 기준
    const currentPage = activeTab === "video" ? videoPagination.currentPage : dtPagination.currentPage;
    const totalItems = activeTab === "video" ? videoPagination.totalItems : dtPagination.totalItems;
    const currentItems = activeTab === "video" ? videoPagination.pagedItems : dtPagination.pagedItems;
    const currentSetPage = activeTab === "video" ? videoPagination.setPage : dtPagination.setPage;

    // video 탭에서 사용할 전용 배열 (타입을 VideoItem[] 으로 고정)
    const videoCurrentItems: VideoItem[] =
    activeTab === "video" ? (currentItems as VideoItem[]) : [];

    const handleTabClick = (tab: "video" | "dt" | "log") => {
        setActiveTab(tab);

        if (tab === "video" && activeTab !== "video") {
            setSelectedVideo(null);
            setSelectedRobot(null);

            const today = new Date();
            const t = periodFormatDate(today);
            setVideoStartDate(t);
            setVideoEndDate(t);
            setSelectedPeriod("today");

        } else if (tab === "dt" && activeTab !== "dt") {
            setSelectedRobot(null);
            setSelectedRobotType(null);
            setDtStartDate(periodFormatDate(new Date()));
            setDtEndDate(periodFormatDate(new Date()));
            setDtPeriod("today");
        } else if (tab === "log") {
        }
    };


    // videoData에서 가장 오래된 날짜 찾기
    const getEarliestVideoDate = () => {
        if (!videoData || videoData.length === 0) return null;

        return videoData.reduce<Date | null>((earliest, item) => {
            const d = new Date(item.date);
            if (isNaN(d.getTime())) return earliest;
            if (!earliest) return d;
            return d < earliest ? d : earliest;
        }, null);
    };

    // 기간 버튼 클릭 처리 (전체 / 당일 / 3일 / 1주)
    const handlePeriodClick = (period: Period | null) => {
        setSelectedPeriod(period);
        const today = new Date();

        if (period === "Total") {
            const earliest = getEarliestVideoDate();
            if (earliest) {
                setVideoStartDate(periodFormatDate(earliest));
                setVideoEndDate(periodFormatDate(today));
            }
            return;
        }

        const start = new Date(today);
        if (period === "today") { /* start = today */ }
        else if (period === "3days") start.setDate(start.getDate() - 3);
        else if (period === "1week") start.setDate(start.getDate() - 7);

        setVideoStartDate(periodFormatDate(start));
        setVideoEndDate(periodFormatDate(today));
    };

    // ── 통계 탭 기간 버튼 ──
    const handleDtPeriodClick = (period: Period | null) => {
        setDtPeriod(period);
        const today = new Date();

        if (period === "Total" || !period) {
            setDtStartDate(dtEarliestDate);
            setDtEndDate(periodFormatDate(today));
            return;
        }

        const start = new Date(today);
        if (period === "today") { /* start = today */ }
        else if (period === "1week") start.setDate(start.getDate() - 7);
        else if (period === "1month") start.setMonth(start.getMonth() - 1);
        else if (period === "1year") start.setFullYear(start.getFullYear() - 1);

        setDtStartDate(periodFormatDate(start));
        setDtEndDate(periodFormatDate(today));
    };

    const formatVideoTime = (time: string) => {
        const parts = time.split(":").map(Number);
        // "mm:ss" 또는 "hh:mm:ss" 모두 처리
        const hh = parts.length >= 3 ? (parts[0] || 0) : 0;
        const mm = parts.length >= 3 ? (parts[1] || 0) : (parts[0] || 0);
        const ss = parts.length >= 3 ? (parts[2] || 0) : (parts[1] || 0);

        let result = "";
        if (hh > 0) result += `${hh}h `;
        if (mm > 0 || hh > 0) result += `${mm}m `;
        result += `${ss}s`;

        return result.trim();
    };

    const videoFormatDate = (datetime: string) => {
        const date = new Date(datetime);

        const yyyy = date.getFullYear();
        const MM = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");

        const hh = String(date.getHours()).padStart(2, "0");
        const mm = String(date.getMinutes()).padStart(2, "0");
        const ss = String(date.getSeconds()).padStart(2, "0");

        return `${yyyy}.${MM}.${dd} ${hh}:${mm}.${ss}`;
    };


    function periodFormatDate(date: Date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    // Video 클릭 시 실행되는 핸들러
    const VideoPlayClick = (idx: number, videoData: VideoItem) => {
        setPlayedVideoId(videoData.id);
        setPlayedVideo(videoData);
        setVideoPlayModalOpen(true)

        console.log("선택된 로봇 (Location 클릭):", videoData.id, videoData.filename);
    };





    // 썸네일 생성
    useEffect(() => {
        const video = document.createElement("video");
        video.src = "/videos/control_system_sample.mp4"; // 여기에 실제 비디오 URL 사용
        video.crossOrigin = "anonymous";
        video.muted = true;

        video.addEventListener("loadeddata", () => {
        video.currentTime = 0.2; // 첫 프레임보다 조금 뒤가 더 잘 보임
        });

        video.addEventListener("seeked", () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext("2d");
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);

        const url = canvas.toDataURL("image/png");
        setVideoThumbnail(url);
        });
    }, []);

    // ── 통계 API 호출 (디바운스 적용) ──
    const pageReadyCalled = React.useRef(false);
    const dtDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const dtFetchIdRef = useRef(0);

    useEffect(() => {
        if (activeTab !== "dt") {
            if (!pageReadyCalled.current && onDataReady) {
                pageReadyCalled.current = true;
                onDataReady();
            }
            return;
        }

        if (dtDebounceRef.current) clearTimeout(dtDebounceRef.current);

        dtDebounceRef.current = setTimeout(() => {
            const id = ++dtFetchIdRef.current;

            getStatistics({
                start_date: dtStartDate ?? undefined,
                end_date: dtEndDate ?? undefined,
                robot_type: selectedRobotType?.label,
                robot_name: selectedRobot?.no,
            }).then((result) => {
                if (id === dtFetchIdRef.current) {
                    setStatsData(result.data);
                    if (result.error) console.error("[통계] API 오류:", result.error);
                    if (!pageReadyCalled.current && onDataReady) {
                        pageReadyCalled.current = true;
                        onDataReady();
                    }
                }
            });
        }, 400);

        return () => {
            if (dtDebounceRef.current) clearTimeout(dtDebounceRef.current);
        };
    }, [activeTab, selectedRobotType, selectedRobot, dtStartDate, dtEndDate]);

    // 로봇 명 셀렉트 옵션: robots API 기반, 로봇 종류 필터 연동
    const robotNameItems = useMemo(() => {
        const source = selectedRobotType
            ? robots.filter(r => r.type === selectedRobotType.label)
            : robots;
        return source.map(r => ({ id: r.id, label: r.no }));
    }, [robots, selectedRobotType]);

    const robotTypeColorMap: Record<string, string> = {
        QUADRUPED: "#fa0203",
        COBOT: "#03abf3",
        AMR: "#97ce4f",
        HUMANOID: "#f79418",
    };

    const robotTypeKorMap: Record<string, string> = {
        QUADRUPED: "4족 보행",
        COBOT: "협동 로봇",
        AMR: "자율주행",
        HUMANOID: "휴머노이드",
    };

    // ── 통계 차트 데이터 (필터 변경 시에만 재계산) ──
    const robotTypeBar = useMemo(() => statsData ? buildRobotTypeBarFromApi(statsData.robot_types) : [], [statsData]);
    const taskBar = useMemo(() => statsData ? buildTaskBarFromApi(statsData.tasks) : [], [statsData]);
    const timeBar = useMemo(() => statsData ? buildTimeBarFromApi(statsData.time_minutes) : [], [statsData]);
    const errorBar = useMemo(() => statsData ? buildErrorBarFromApi(statsData.errors) : [], [statsData]);

    const { totalRobots, totalTasks, totalErrors, opHText, opMText, timeHText, timeMText } = useMemo(() => {
        const robots = statsData?.robot_types.reduce((s, t) => s + t.count, 0) ?? 0;
        const tasks = statsData ? Object.values(statsData.tasks).reduce((s, v) => s + v, 0) : 0;
        const errors = statsData ? Object.values(statsData.errors).reduce((s, v) => s + v, 0) : 0;
        // KPI "총 운행" = 운행시간만
        const opMin = statsData?.time_minutes.operating ?? 0;
        const opStr = convertMinutesToText(opMin);
        const opParts = opStr.split(" ");
        // 시간 통계 헤더 = 운행+충전+대기 합계 (온라인 시간)
        const totalMin = statsData ? Object.values(statsData.time_minutes).reduce((s, v) => s + v, 0) : 0;
        const totalStr = convertMinutesToText(totalMin);
        const totalParts = totalStr.split(" ");
        return {
            totalRobots: robots, totalTasks: tasks, totalErrors: errors,
            opHText: opParts[0] ?? "0h", opMText: opParts[1] ?? "0m",
            timeHText: totalParts[0] ?? "0h", timeMText: totalParts[1] ?? "0m",
        };
    }, [statsData]);

    // 영상 다운로드(임시)
    // ── 선택 삭제 핸들러 ──
    const toggleSelectMode = () => {
        if (selectMode) {
            setSelectedIds(new Set());
        }
        setSelectMode(!selectMode);
    };

    const toggleSelect = (groupId: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    };

    const toggleSelectAll = () => {
        const currentGroupIds = videoCurrentItems.map(r => r.group_id || String(r.id));
        const allSelected = currentGroupIds.every(id => selectedIds.has(id));
        if (allSelected) {
            setSelectedIds(prev => {
                const next = new Set(prev);
                currentGroupIds.forEach(id => next.delete(id));
                return next;
            });
        } else {
            setSelectedIds(prev => {
                const next = new Set(prev);
                currentGroupIds.forEach(id => next.add(id));
                return next;
            });
        }
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
                // 삭제된 항목을 로컬 데이터에서 제거
                if (searchFilterData) {
                    setSearchFilterData(
                        searchFilterData.filter(v => !selectedIds.has(v.group_id || String(v.id)))
                    );
                }
                setSelectedIds(new Set());
                setSelectMode(false);
            }
        } catch (e) {
            console.error("[VideoList] 삭제 실패:", e);
        } finally {
            setIsDeleting(false);
            setDeleteConfirmOpen(false);
        }
    };

    const downloadVideo = async (video: VideoItem) => {
        if (!video.id) return;

        // 파일명: 로봇명_카메라_타입_날짜시간.mp4
        const dateStr = video.record_start
            ? new Date(video.record_start).toISOString().replace(/[-:T]/g, "").slice(0, 15)
            : "unknown";
        const filename = `${video.robotNo}_${video.cameraNo}_${video.record_type || ""}_${dateStr}.mp4`;

        try {
            const res = await apiFetch(`/api/recordings/download/${video.id}?filename=${encodeURIComponent(filename)}`);
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
            console.error("[VideoList] 다운로드 실패:", e);
        }
    };

  return (
    <>
    <div className="page-header-tab">
        <h1>데이터 관리</h1>
        <div className={styles.videoListTab}>
            <div className={`${activeTab === "video" ? styles.active : ""}`} onClick={() => handleTabClick("video")}>영상 관리</div>
            <div className={`${activeTab === "dt" ? styles.active : ""}`} onClick={() => handleTabClick("dt")}>통계 관리</div>
            <div className={`${activeTab === "log" ? styles.active : ""}`} onClick={() => handleTabClick("log")}>로그 관리</div>
        </div>
    </div>

    {/* Recording Video 화면 */}
    {activeTab === "video" && (
        <div className={styles.videoList}>
                <div className={styles.videoListTopPosition}>
                    <h2>영상 관리</h2>
                    <div className={styles.videoSearch}>
                        <div className={styles.videoSelect}>
                            <FilterSelectBox
                                items={video.map(v => ({ id: v.id, label: v.label }))}
                                selectedLabel={selectedVideo?.label ?? null}
                                placeholder="녹화 타입"
                                showTotal={true}
                                onSelect={(item) => {
                                    if (item) {
                                        const found = video.find(v => v.label === item.label);
                                        if (found) setSelectedVideo(found);
                                    } else {
                                        setSelectedVideo(null);
                                    }
                                }}
                            />
                            <FilterSelectBox
                                items={robots.map(r => ({ id: r.id, label: r.no }))}
                                selectedLabel={selectedRobot?.no ?? null}
                                placeholder="로봇 명"
                                showTotal={robots.length > 0}
                                onSelect={(item) => {
                                    if (item) {
                                        const robot = robots.find(r => r.no === item.label);
                                        if (robot) setSelectedRobot(robot);
                                    } else {
                                        setSelectedRobot(null);
                                    }
                                }}
                            />
                        </div>
                        <div className={styles.videoPeriod}>
                            {([
                                { key: "Total", label: "전체" },
                                { key: "today", label: "당일" },
                                { key: "3days", label: "3일" },
                                { key: "1week", label: "1주" },
                            ] as const).map(({ key, label }) => (
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
                                    <div className={styles.videoWorkBtn} onClick={toggleSelectMode}>
                                        취소
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
                <div className={styles.contentArea}>
                    {videoCurrentItems.length === 0 ? (
                        <div className={styles.emptyState}>
                            <span>{searchFilterData !== null ? "조건에 맞는 영상이 없습니다" : "녹화된 영상이 없습니다"}</span>
                        </div>
                    ) : (
                        <div className={styles.videoViewContainer}>
                            {videoCurrentItems.map((r, idx) => {
                                const itemKey = r.group_id || String(r.id);
                                return (
                                <div key={itemKey} className={`${styles.videoViewItem} ${selectMode && selectedIds.has(itemKey) ? styles.videoViewItemSelected : ""}`}>
                                    <div className={styles.videoViewBox} onClick={() => {
                                        if (selectMode) { toggleSelect(itemKey); }
                                        else { VideoPlayClick(idx, r); }
                                    }}>
                                        <div className={styles.videoView}>
                                            <img
                                              src={r.thumbnail_url || videoThumbnail || '/icon/video_placeholder.png'}
                                              alt="thumbnail"
                                            />
                                        </div>
                                        <div className={styles.videoViewIcon} onMouseEnter={() => setHoveredIndex(idx)} onMouseLeave={() => setHoveredIndex(null)}>
                                            <img src={ hoveredIndex === idx ? `/icon/video_hover_icon.png` : `/icon/video_icon.png`} alt="play" />
                                        </div>
                                    </div>
                                    <div className={styles.videoMeta}>
                                        <div className={styles.metaRow1}>
                                            <span className={styles.metaPrimary}>{r.robotNo} · {r.cameraNo}</span>
                                            <div className={styles.videoExport} onClick={(e) => { e.stopPropagation(); downloadVideo(r); }}>
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
                <Pagination   totalItems={totalItems}
                currentPage={currentPage}
                onPageChange={currentSetPage}
                pageSize={PAGE_SIZE}
                blockSize={5} />
            </div>
            <VideoPlayModal isOpen={videoPlayModalOpen} onClose={() => setVideoPlayModalOpen(false)} playedVideo={playedVideo} />
            {deleteConfirmOpen && (
                <CancelConfirmModal
                    message={`선택한 영상 ${selectedIds.size}건을 삭제하시겠습니까?`}
                    onConfirm={handleDeleteSelected}
                    onCancel={() => setDeleteConfirmOpen(false)}
                />
            )}
        </div>
    )}

    {/* ═══ Statistical Info 화면 ═══ */}
    {activeTab === "dt" && (
        <div className={styles.DT}>
            {/* 헤더 + 필터 */}
            <div className={styles.videoListTopPosition}>
                <h2>통계 관리</h2>
                <div className={styles.dtSearch}>
                    <div className={styles.videoSelect}>
                        <FilterSelectBox
                            items={robotTypeData.map(t => ({ id: t.id, label: robotTypeKorMap[t.label] ?? t.label }))}
                            selectedLabel={selectedRobotType ? (robotTypeKorMap[selectedRobotType.label] ?? selectedRobotType.label) : null}
                            placeholder="로봇 종류"
                            showTotal={true}
                            onSelect={(item) => {
                                if (item) {
                                    const type = robotTypeData.find(t => (robotTypeKorMap[t.label] ?? t.label) === item.label);
                                    if (type) {
                                        setSelectedRobotType(type);
                                        if (selectedRobot && selectedRobot.type !== type.label) setSelectedRobot(null);
                                    }
                                } else { setSelectedRobotType(null); }
                            }}
                        />
                        <FilterSelectBox
                            items={robotNameItems}
                            selectedLabel={selectedRobot?.no ?? null}
                            placeholder="로봇 명"
                            showTotal={robots.length > 0}
                            onSelect={(item) => {
                                if (item) {
                                    const r = robots.find(r => r.no === item.label);
                                    if (r) { setSelectedRobot(r); if (selectedRobotType && selectedRobotType.label !== r.type) setSelectedRobotType(null); }
                                } else { setSelectedRobot(null); }
                            }}
                        />
                    </div>
                    <div className={styles.dtPeriod}>
                        {([{ key: "Total", label: "전체" }, { key: "today", label: "당일" }, { key: "1week", label: "1주" }, { key: "1month", label: "1달" }, { key: "1year", label: "1년" }] as const).map(({ key, label }) => (
                            <div key={key} className={`${styles.periodItem} ${dtPeriod === key ? styles.active : ""}`} onClick={() => handleDtPeriodClick(key)}>{label}</div>
                        ))}
                    </div>
                    {/* 기간 직접 선택 (달력) — 영상 탭과 동일 스타일 */}
                    <div ref={dtCalendarRef} className={styles.dtDateRange}>
                        <div
                            className={`${styles.dtDateInput} ${dtActiveField === "start" && dtCalendarOpen ? styles.active : ""}`}
                            onClick={() => { setDtActiveField("start"); setDtCalendarOpen(true); }}
                        >
                            <div>{dtStartDate ?? "시작일"}</div>
                            <img src="/icon/search_calendar.png" alt="calendar" />
                        </div>
                        <div className={styles.dtDateSep}>~</div>
                        <div
                            className={`${styles.dtDateInput} ${dtActiveField === "end" && dtCalendarOpen ? styles.active : ""}`}
                            onClick={() => { setDtActiveField("end"); setDtCalendarOpen(true); }}
                        >
                            <div>{dtEndDate ?? "종료일"}</div>
                            <img src="/icon/search_calendar.png" alt="calendar" />
                        </div>
                        {dtCalendarOpen && (
                            <div className={styles.dtCalendarDropdown}>
                                <BaseCalendar
                                    mode="range"
                                    startDate={dtStartDate}
                                    endDate={dtEndDate}
                                    activeField={dtActiveField}
                                    onRangeSelect={(field, date) => {
                                        if (field === "start") {
                                            setDtStartDate(date);
                                            if (dtEndDate && date > dtEndDate) setDtEndDate(date);
                                            setDtActiveField("end");
                                        } else {
                                            setDtEndDate(date);
                                            if (dtStartDate && date < dtStartDate) setDtStartDate(date);
                                            setDtCalendarOpen(false);
                                        }
                                        setDtPeriod(null);
                                    }}
                                    maxDate={periodFormatDate(new Date())}
                                    showTodayButton
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── KPI 카드 (라벨 좌 | 숫자+단위 우) ── */}
            <div className={styles.kpiRow}>
                <div className={styles.kpiCard} style={{ animationDelay: "0s" }}>
                    <span className={styles.kpiLabel}>총 로봇</span>
                    <div className={styles.kpiRight}>
                        <span className={styles.kpiNum} style={{ color: "#92d4f4" }}>{totalRobots}</span><span className={styles.kpiUnit}>units</span>
                    </div>
                    <div className={styles.kpiBar} style={{ background: "#92d4f4" }} />
                </div>
                <div className={styles.kpiCard} style={{ animationDelay: "0.06s" }}>
                    <span className={styles.kpiLabel}>총 작업</span>
                    <div className={styles.kpiRight}>
                        <span className={styles.kpiNum} style={{ color: "#92ca60" }}>{totalTasks}</span><span className={styles.kpiUnit}>건</span>
                    </div>
                    <div className={styles.kpiBar} style={{ background: "#77a251" }} />
                </div>
                <div className={styles.kpiCard} style={{ animationDelay: "0.12s" }}>
                    <span className={styles.kpiLabel}>총 에러</span>
                    <div className={styles.kpiRight}>
                        <span className={styles.kpiNum} style={{ color: totalErrors > 0 ? "#e06b73" : "#5d6174" }}>{totalErrors}</span><span className={styles.kpiUnit}>건</span>
                    </div>
                    <div className={styles.kpiBar} style={{ background: totalErrors > 0 ? "#c2434c" : "#5d6174" }} />
                </div>
                <div className={styles.kpiCard} style={{ animationDelay: "0.18s" }}>
                    <span className={styles.kpiLabel}>총 운행</span>
                    <div className={styles.kpiRight}>
                        <span className={styles.kpiNum} style={{ color: "#4db8e8" }}>{opHText.replace("h","")}</span><span className={styles.kpiNumSub}>h</span>
                        <span className={styles.kpiNum} style={{ color: "#4db8e8", marginLeft: 2 }}>{opMText.replace("m","")}</span><span className={styles.kpiNumSub}>m</span>
                    </div>
                    <div className={styles.kpiBar} style={{ background: "#0e8ebf" }} />
                </div>
            </div>

            {/* ── 통계 + 이벤트 영역 ── */}
            <div className={styles.statsBody}>
                {/* 좌: 2×2 통계 그리드 */}
                <div className={styles.statsGrid}>
                    {/* 좌상 — 로봇 타입 */}
                    <div className={styles.statsCell}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#92d4f4" }} />
                            <h3>로봇 타입</h3>
                            <span className={styles.cellSum} style={{ color: "#92d4f4" }}>{totalRobots}<span>units</span></span>
                        </div>
                        <HorizontalBarChart items={robotTypeBar} color="#92d4f4" unit="대" />
                    </div>

                    {/* 우상 — 작업 통계 */}
                    <div className={styles.statsCell}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#77a251" }} />
                            <h3>작업 통계</h3>
                            <span className={styles.cellSum} style={{ color: "#92ca60" }}>{totalTasks}<span>건</span></span>
                        </div>
                        <HorizontalBarChart items={taskBar} color="#77a251" unit="건" />
                    </div>

                    {/* 좌하 — 시간 통계 */}
                    <div className={styles.statsCell}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#0e8ebf" }} />
                            <h3>시간 통계</h3>
                            <span className={styles.cellSum} style={{ color: "#4db8e8" }}>{timeHText.replace("h","")}<span>h</span> {timeMText.replace("m","")}<span>m</span></span>
                        </div>
                        <HorizontalBarChart items={timeBar} color="#0e8ebf" unit="m" />
                    </div>

                    {/* 우하 — 에러 통계 */}
                    <div className={styles.statsCell}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#c2434c" }} />
                            <h3>에러 통계</h3>
                            <span className={styles.cellSum} style={{ color: "#e06b73" }}>{totalErrors}<span>건</span></span>
                        </div>
                        <HorizontalBarChart items={errorBar} color="#c2434c" unit="건" />
                    </div>
                </div>

                {/* 우: 로봇별 요약 테이블 */}
                <div className={styles.robotTable}>
                    <div className={styles.cellHead}>
                        <div className={styles.cellDot} style={{ background: "var(--color-accent)" }} />
                        <h3>로봇별 현황</h3>
                    </div>
                    <div className={styles.rtHeader}>
                        <span className={styles.rtHName}>로봇</span>
                        <span className={styles.rtHTask}>작업<span>(완료/총)</span></span>
                        <span className={styles.rtHNum}>에러</span>
                        <span className={styles.rtHWide}>운행</span>
                        <span className={styles.rtHWide}>충전</span>
                    </div>
                    <div className={styles.rtBody}>
                        {(statsData?.per_robot ?? []).map((r) => {
                            const opH = Math.floor(r.operating_minutes / 60);
                            const opM = Math.round(r.operating_minutes % 60);
                            const chH = Math.floor(r.charging_minutes / 60);
                            const chM = Math.round(r.charging_minutes % 60);
                            return (
                                <div key={r.robot_id} className={styles.rtRow}>
                                    <div className={styles.rtName}>
                                        <span>{r.robot_name}</span>
                                    </div>
                                    <span className={styles.rtTask}>{r.tasks_completed}<span>/{r.tasks_total}</span></span>
                                    <span className={`${styles.rtNum} ${r.errors_total > 0 ? styles.rtError : ""}`}>{r.errors_total}</span>
                                    <span className={styles.rtWide}>{opH} <span>h</span> {opM} <span>m</span></span>
                                    <span className={styles.rtWide}>{chH} <span>h</span> {chM} <span>m</span></span>
                                </div>
                            );
                        })}
                        {(!statsData?.per_robot || statsData.per_robot.length === 0) && (
                            <div className={styles.rtEmpty}>등록된 로봇 없음</div>
                        )}
                    </div>
                </div>
            </div>

        </div>
    )}


    {/* Log History 화면 */}
    {activeTab === "log" && (
        <div className={styles.DT}>
            <LogList logData={logData} initialSearch={initialSearch} />
        </div>
    )}
    </>
  );
}
