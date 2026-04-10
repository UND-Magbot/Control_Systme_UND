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
import KpiSummaryCard from "./KpiSummaryCard";
import ComparisonCard from "./ComparisonCard";
import DonutWithLegend from "./DonutWithLegend";
import VerticalBarChart from "./VerticalBarChart";
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
import getVideoInfo from "@/app/lib/videoData";

const PAGE_SIZE = 8;

const ROBOT_TYPE_COLOR_MAP: Record<string, string> = {
    QUADRUPED: "#fa0203",
    COBOT: "#03abf3",
    AMR: "#97ce4f",
    HUMANOID: "#f79418",
};

const ROBOT_TYPE_KOR_MAP: Record<string, string> = {
    QUADRUPED: "4족 보행",
    COBOT: "협동 로봇",
    AMR: "자율주행",
    HUMANOID: "휴머노이드",
};

type VideoListProps = {
  cameras: Camera[];
  video: Video[];
  robotTypeData: RobotType[];
  onDataReady?: () => void;
  initialTab?: "video" | "dt" | "log";
  initialSearch?: string;
}


export default function VideoList({
    video,
    robotTypeData,
    onDataReady,
    initialTab,
    initialSearch,
}:VideoListProps) {

    const { robots } = useRobotStatusContext();
    const [videoData, setVideoData] = useState<VideoItem[]>([]);
    const [logData, setLogData] = useState<LogItem[]>([]);
    const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
    const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);
    // ── 탭별 지연 로딩 (ref만 선언, useEffect는 activeTab 선언 뒤) ──
    const logLoadedRef = useRef(false);

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

    const [videoPlayModalOpen, setVideoPlayModalOpen] = useState(false);
    const [playedVideoId, setPlayedVideoId] = useState<number | null>(null);
    const [playedVideo, setPlayedVideo] = useState<VideoItem | null>(null);
    const videoThumbnailFallback = '/icon/video_placeholder.png';

    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<"video" | "dt" | "log">(initialTab || "video");

    // ── 로그 탭 지연 로딩 ──
    useEffect(() => {
        if (activeTab === "log" && !logLoadedRef.current) {
            logLoadedRef.current = true;
            const today = new Date();
            const todayFmt = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
            getLogData({ start_date: todayFmt, end_date: todayFmt }).then((res) => setLogData(res.items));
        }
    }, [activeTab]);

    // ── 선택 삭제 모드 ──
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    // ── 통계 API 상태 ──
    const [statsData, setStatsData] = useState<StatisticsResponse | null>(null);
    const [prevStatsData, setPrevStatsData] = useState<StatisticsResponse | null>(null);

    // 통계 탭 전용 날짜 필터 (당일 기본값 — 영상 탭과 동일)
    const todayInit = (() => { const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,"0"); const dd = String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${dd}`; })();
    const [dtStartDate, setDtStartDate] = useState<string | null>(todayInit);
    const [dtEndDate, setDtEndDate] = useState<string | null>(todayInit);
    const [dtPeriod, setDtPeriod] = useState<Period | null>("today");

    // 가장 이른 데이터 날짜 (dt탭 활성 시 1회 조회, "전체" 즉시 반영용)
    const [dtEarliestDate, setDtEarliestDate] = useState<string | null>(null);
    const dtEarliestLoadedRef = useRef(false);
    useEffect(() => {
        if (activeTab === "dt" && !dtEarliestLoadedRef.current) {
            dtEarliestLoadedRef.current = true;
            apiFetch("/DB/statistics/earliest-date")
                .then((res) => res.ok ? res.json() : null)
                .then((data) => { if (data?.earliest_date) setDtEarliestDate(data.earliest_date); })
                .catch(() => {});
        }
    }, [activeTab]);

    // 통계 탭 달력
    const [dtCalendarOpen, setDtCalendarOpen] = useState(false);
    const [dtActiveField, setDtActiveField] = useState<"start" | "end">("start");
    const dtCalendarRef = useRef<HTMLDivElement>(null);
    useOutsideClick(dtCalendarRef, useCallback(() => setDtCalendarOpen(false), []));

    // 페이지 로딩 완료 콜백 (탭 관계없이 최초 1회)
    const pageReadyCalled = useRef(false);

    // 영상 탭: 서버 사이드 필터링 (필터 변경 시 API 재호출)
    const videoDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const videoFetchIdRef = useRef(0);

    useEffect(() => {
        if (activeTab !== "video") return;

        if (videoDebounceRef.current) clearTimeout(videoDebounceRef.current);

        videoDebounceRef.current = setTimeout(() => {
            const id = ++videoFetchIdRef.current;

            const robot = selectedRobot ? robots.find(r => r.no === selectedRobot.no) : null;

            getVideoInfo({
                robot_id: robot?.id ?? undefined,
                record_type: selectedVideo?.label ?? undefined,
                start_date: videoStartDate || undefined,
                end_date: videoEndDate || undefined,
                size: 100,
            }).then((res) => {
                if (id === videoFetchIdRef.current) {
                    setVideoData(res.items);
                    if (!pageReadyCalled.current && onDataReady) {
                        pageReadyCalled.current = true;
                        onDataReady();
                    }
                }
            });
        }, 400);

        return () => {
            if (videoDebounceRef.current) clearTimeout(videoDebounceRef.current);
        };
    }, [activeTab, selectedVideo, selectedRobot, videoStartDate, videoEndDate]);

    // 탭별 페이지네이션
    const videoPagination = usePaginatedList(videoData, {
      pageSize: PAGE_SIZE,
      resetDeps: [selectedVideo, selectedRobot, videoStartDate, videoEndDate],
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


    // 영상 탭: 가장 이른 녹화 날짜 (서버 조회, 1회)
    const [videoEarliestDate, setVideoEarliestDate] = useState<string | null>(null);
    const videoEarliestLoadedRef = useRef(false);
    useEffect(() => {
        if (activeTab === "video" && !videoEarliestLoadedRef.current) {
            videoEarliestLoadedRef.current = true;
            apiFetch("/api/recordings/earliest-date")
                .then((res) => res.ok ? res.json() : null)
                .then((data) => { if (data?.earliest_date) setVideoEarliestDate(data.earliest_date); })
                .catch(() => {});
        }
    }, [activeTab]);

    // 기간 버튼 클릭 처리 (전체 / 당일 / 3일 / 1주)
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

    // ── 통계 Excel 내보내기 ──
    const exportStatsToExcel = async () => {
        if (!statsData) return;

        const XLSX = await import("xlsx");

        // Sheet 1: 요약 통계 (그룹별 — Summary Card 데이터 반영)
        const totalTasks = statsData.tasks.completed + statsData.tasks.failed + statsData.tasks.cancelled;
        const totalTime = statsData.time_minutes.operating + statsData.time_minutes.charging + statsData.time_minutes.standby;
        const totalErrors = statsData.errors.network + statsData.errors.navigation + statsData.errors.battery + statsData.errors.etc;
        const totalRobots = statsData.robot_types.reduce((s, t) => s + t.count, 0);
        const taskSuccessRate = totalTasks > 0 ? Math.round((statsData.tasks.completed / totalTasks) * 100) : 0;
        const errorRate = totalTasks > 0 ? Math.round((statsData.tasks.failed / totalTasks) * 100) : 0;
        const opRate = totalTime > 0 ? Math.round((statsData.time_minutes.operating / totalTime) * 100) : 0;

        const taskBlock = [
            ["[작업 현황]"],
            ["항목", "값", "단위", "비율(%)"],
            ["완료", statsData.tasks.completed, "건", totalTasks > 0 ? `${Math.round((statsData.tasks.completed / totalTasks) * 100)}%` : "0%"],
            ["실패", statsData.tasks.failed, "건", totalTasks > 0 ? `${Math.round((statsData.tasks.failed / totalTasks) * 100)}%` : "0%"],
            ["취소", statsData.tasks.cancelled, "건", totalTasks > 0 ? `${Math.round((statsData.tasks.cancelled / totalTasks) * 100)}%` : "0%"],
            ["합계", totalTasks, "건", "100%"],
            ["", "", "", ""],
            ["성공률", `${taskSuccessRate}%`, "", ""],
        ];
        const robotBlock = [
            ["[로봇 현황]"],
            ["항목", "값", "단위"],
            ...statsData.robot_types.map((t) => [ROBOT_TYPE_KOR_MAP[t.type] ?? t.type, t.count, "대"]),
            ["합계", totalRobots, "대"],
        ];
        const errorBlock = [
            ["[에러 현황]"],
            ["항목", "값", "단위", "비율(%)"],
            ["네트워크", statsData.errors.network, "건", totalErrors > 0 ? `${Math.round((statsData.errors.network / totalErrors) * 100)}%` : "0%"],
            ["네비게이션", statsData.errors.navigation, "건", totalErrors > 0 ? `${Math.round((statsData.errors.navigation / totalErrors) * 100)}%` : "0%"],
            ["배터리", statsData.errors.battery, "건", totalErrors > 0 ? `${Math.round((statsData.errors.battery / totalErrors) * 100)}%` : "0%"],
            ["기타", statsData.errors.etc, "건", totalErrors > 0 ? `${Math.round((statsData.errors.etc / totalErrors) * 100)}%` : "0%"],
            ["합계", totalErrors, "건", "100%"],
            ["", "", "", ""],
            ["에러율", `${errorRate}%`, "", ""],
        ];
        const timeBlock = [
            ["[운행 시간]"],
            ["항목", "값(분)", "시간", "비율(%)"],
            ["운행", statsData.time_minutes.operating, convertMinutesToText(statsData.time_minutes.operating), `${opRate}%`],
            ["충전", statsData.time_minutes.charging, convertMinutesToText(statsData.time_minutes.charging), totalTime > 0 ? `${Math.round((statsData.time_minutes.charging / totalTime) * 100)}%` : "0%"],
            ["대기", statsData.time_minutes.standby, convertMinutesToText(statsData.time_minutes.standby), totalTime > 0 ? `${Math.round((statsData.time_minutes.standby / totalTime) * 100)}%` : "0%"],
            ["합계", totalTime, convertMinutesToText(totalTime), "100%"],
            ["", "", "", ""],
            ["가동률", `${opRate}%`, "", ""],
        ];

        // 2x2 레이아웃: 좌상=작업, 우상=로봇, 좌하=에러, 우하=시간
        const summaryWs = XLSX.utils.aoa_to_sheet(taskBlock, { origin: "A1" } as any);
        XLSX.utils.sheet_add_aoa(summaryWs, robotBlock, { origin: "F1" });
        XLSX.utils.sheet_add_aoa(summaryWs, errorBlock, { origin: "A12" });
        XLSX.utils.sheet_add_aoa(summaryWs, timeBlock, { origin: "F12" });

        // Sheet 2: 로봇별 현황 (성공률 컬럼 추가)
        const robotRows = statsData.per_robot.map((r) => {
            const rSuccessRate = r.tasks_total > 0 ? Math.round((r.tasks_completed / r.tasks_total) * 100) : 0;
            return {
                "로봇 명": r.robot_name,
                "로봇 타입": ROBOT_TYPE_KOR_MAP[r.robot_type] ?? r.robot_type,
                "성공률(%)": `${rSuccessRate}%`,
                "완료 작업": r.tasks_completed,
                "총 작업": r.tasks_total,
                "에러": r.errors_total,
                "운행 시간(분)": r.operating_minutes,
                "운행 시간": convertMinutesToText(r.operating_minutes),
                "충전 시간(분)": r.charging_minutes,
                "충전 시간": convertMinutesToText(r.charging_minutes),
                "대기 시간(분)": r.standby_minutes,
                "대기 시간": convertMinutesToText(r.standby_minutes),
            };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, summaryWs, "요약 통계");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(robotRows), "로봇별 현황");

        const dateStr = periodFormatDate(new Date());
        XLSX.writeFile(wb, `statistics_export_${dateStr}.xlsx`);
    };

    // Video 클릭 시 실행되는 핸들러
    const VideoPlayClick = (idx: number, videoData: VideoItem) => {
        setPlayedVideoId(videoData.id);
        setPlayedVideo(videoData);
        setVideoPlayModalOpen(true)

        console.log("선택된 로봇 (Location 클릭):", videoData.id, videoData.filename);
    };





    // ── 이전 기간 날짜 계산 ──
    const calcPrevPeriod = useCallback((start: string | null, end: string | null): { prevStart: string; prevEnd: string } | null => {
        if (!start || !end) return null;
        const s = new Date(start);
        const e = new Date(end);
        const diffMs = e.getTime() - s.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        // "전체" 기간이면 비교 없음
        if (diffDays > 365) return null;
        const prevEnd = new Date(s);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - diffDays);
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        return { prevStart: fmt(prevStart), prevEnd: fmt(prevEnd) };
    }, []);

    // ── 통계 API 호출 (디바운스 적용, 이전 기간 병렬 호출) ──
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
            const baseParams = {
                robot_type: selectedRobotType?.label,
                robot_name: selectedRobot?.no,
            };

            const currentFetch = getStatistics({
                ...baseParams,
                start_date: dtStartDate ?? undefined,
                end_date: dtEndDate ?? undefined,
            });

            const prev = calcPrevPeriod(dtStartDate, dtEndDate);
            const prevFetch = prev
                ? getStatistics({ ...baseParams, start_date: prev.prevStart, end_date: prev.prevEnd })
                : Promise.resolve(null);

            Promise.all([currentFetch, prevFetch]).then(([result, prevResult]) => {
                if (id === dtFetchIdRef.current) {
                    setStatsData(result.data);
                    setPrevStatsData(prevResult?.data ?? null);
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
    }, [activeTab, selectedRobotType, selectedRobot, dtStartDate, dtEndDate, calcPrevPeriod]);

    // 로봇 명 셀렉트 옵션: robots API 기반, 로봇 종류 필터 연동
    const robotNameItems = useMemo(() => {
        const source = selectedRobotType
            ? robots.filter(r => r.type === selectedRobotType.label)
            : robots;
        return source.map(r => ({ id: r.id, label: r.no }));
    }, [robots, selectedRobotType]);

    const robotTypeColorMap = ROBOT_TYPE_COLOR_MAP;
    const robotTypeKorMap = ROBOT_TYPE_KOR_MAP;

    // ── 통계 차트 데이터 (필터 변경 시에만 재계산) ──
    const robotTypeBar = useMemo(() => statsData ? buildRobotTypeBarFromApi(statsData.robot_types) : [], [statsData]);
    const taskBar = useMemo(() => statsData ? buildTaskBarFromApi(statsData.tasks) : [], [statsData]);
    const timeBar = useMemo(() => statsData ? buildTimeBarFromApi(statsData.time_minutes) : [], [statsData]);
    const errorBar = useMemo(() => statsData ? buildErrorBarFromApi(statsData.errors) : [], [statsData]);

    // ── 이전 기간 차트 데이터 ──
    const prevRobotTypeBar = useMemo(() => prevStatsData ? buildRobotTypeBarFromApi(prevStatsData.robot_types) : [], [prevStatsData]);
    const prevTaskBar = useMemo(() => prevStatsData ? buildTaskBarFromApi(prevStatsData.tasks) : [], [prevStatsData]);
    const prevTimeBar = useMemo(() => prevStatsData ? buildTimeBarFromApi(prevStatsData.time_minutes) : [], [prevStatsData]);
    const prevErrorBar = useMemo(() => prevStatsData ? buildErrorBarFromApi(prevStatsData.errors) : [], [prevStatsData]);

    // 비교 라벨 (필터 기간에 따라)
    const prevLabel = useMemo(() => {
        if (!dtStartDate || !dtEndDate) return "";
        const diffDays = Math.round((new Date(dtEndDate).getTime() - new Date(dtStartDate).getTime()) / (1000*60*60*24));
        if (diffDays <= 0) return "전일";
        if (diffDays <= 7) return "전주";
        if (diffDays <= 31) return "전월";
        if (diffDays <= 365) return "전년";
        return "";
    }, [dtStartDate, dtEndDate]);

    const statsSummary = useMemo(() => {
        const robots = statsData?.robot_types.reduce((s, t) => s + t.count, 0) ?? 0;
        const tasks = statsData ? Object.values(statsData.tasks).reduce((s, v) => s + v, 0) : 0;
        const errors = statsData ? Object.values(statsData.errors).reduce((s, v) => s + v, 0) : 0;
        const completed = statsData?.tasks.completed ?? 0;
        const failed = statsData?.tasks.failed ?? 0;
        const cancelled = statsData?.tasks.cancelled ?? 0;
        const taskSuccessRate = tasks > 0 ? Math.round((completed / tasks) * 100) : 0;
        const errorRate = tasks > 0 ? Math.round((failed / tasks) * 100) : 0;
        const opMin = statsData?.time_minutes.operating ?? 0;
        const opStr = convertMinutesToText(opMin);
        const opParts = opStr.split(" ");
        const totalMin = statsData ? Object.values(statsData.time_minutes).reduce((s, v) => s + v, 0) : 0;
        const totalStr = convertMinutesToText(totalMin);
        const totalParts = totalStr.split(" ");
        const opRate = totalMin > 0 ? Math.round((opMin / totalMin) * 100) : 0;
        const chgMin = statsData?.time_minutes.charging ?? 0;
        const stdMin = statsData?.time_minutes.standby ?? 0;

        // 이전 기간 총합
        const prevTasks = prevStatsData ? Object.values(prevStatsData.tasks).reduce((s, v) => s + v, 0) : null;
        const prevErrors = prevStatsData ? Object.values(prevStatsData.errors).reduce((s, v) => s + v, 0) : null;
        const prevOpMin = prevStatsData?.time_minutes.operating ?? null;
        const prevRobots = prevStatsData?.robot_types.reduce((s, t) => s + t.count, 0) ?? null;

        // 델타 (null = 비교 데이터 없음)
        const taskDelta = prevTasks !== null ? tasks - prevTasks : null;
        const errorDelta = prevErrors !== null ? errors - prevErrors : null;
        const opDelta = prevOpMin !== null ? opMin - prevOpMin : null;
        const robotDelta = prevRobots !== null ? robots - prevRobots : null;

        return {
            totalRobots: robots, totalTasks: tasks, totalErrors: errors,
            completed, failed, cancelled,
            taskSuccessRate, errorRate,
            opHText: opParts[0] ?? "0h", opMText: opParts[1] ?? "0m",
            timeHText: totalParts[0] ?? "0h", timeMText: totalParts[1] ?? "0m",
            opMin, chgMin, stdMin, totalMin, opRate,
            taskDelta, errorDelta, opDelta, robotDelta, prevLabel,
        };
    }, [statsData, prevStatsData, prevLabel]);

    const { totalRobots, totalTasks, totalErrors, opHText, opMText, timeHText, timeMText } = statsSummary;

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
                setVideoData(
                    videoData.filter(v => !selectedIds.has(v.group_id || String(v.id)))
                );
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
                            <span>조건에 맞는 영상이 없습니다</span>
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
                                            {r.thumbnail_url ? (
                                                <img
                                                  src={r.thumbnail_url}
                                                  alt="thumbnail"
                                                  onError={(e) => {
                                                      (e.target as HTMLImageElement).style.display = 'none';
                                                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove(styles.hidden);
                                                  }}
                                                />
                                            ) : null}
                                            <div className={`${styles.thumbPlaceholder} ${r.thumbnail_url ? styles.hidden : ''}`}>
                                                <img src="/icon/video_icon.png" alt="" />
                                                <span>{r.cameraNo || '카메라'}</span>
                                            </div>
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
                            width={160}
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
                            width={180}
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
                    <button className={styles.excelButton} onClick={exportStatsToExcel}>Excel 내보내기</button>
                </div>
            </div>

            {/* ── 3단 레이아웃: KPI 요약 → 상세 차트 → 기간 비교 ── */}
            <div className={styles.statsLayout}>

                {/* Section 1: KPI 요약 카드 (로봇 → 운행 → 작업 → 에러) */}
                <div className={styles.kpiRow}>
                    <KpiSummaryCard title="로봇 현황" color="#92d4f4" value={totalRobots.toString()} unit="대" />
                    <KpiSummaryCard title="운행 시간" color="#0e8ebf" value={`${opHText.replace("h","")}h ${opMText.replace("m","")}m`} subValue={`가동률 ${statsSummary.opRate}%`} subColor="#4db8e8" />
                    <KpiSummaryCard title="작업 현황" color="#77a251" value={totalTasks.toLocaleString()} unit="건" subValue={`성공률 ${statsSummary.taskSuccessRate}%`} subColor="#77a251" />
                    <KpiSummaryCard title="에러 현황" color="#c2434c" value={totalErrors.toString()} unit="건" subValue={totalErrors > 0 ? `에러율 ${statsSummary.errorRate}%` : undefined} subColor="#e06b73" />
                </div>

                {/* Section 2: 상세 차트 4열 (로봇 → 운행 → 작업 → 에러) */}
                <div className={styles.detailRow}>
                    <div className={styles.chartCard}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#92d4f4" }} />
                            <h3>로봇 타입</h3>
                            <span className={styles.cellSum} style={{ color: "#92d4f4" }}>{totalRobots}<span>대</span></span>
                        </div>
                        <VerticalBarChart
                            items={robotTypeBar} color="#92d4f4"
                            prevItems={prevRobotTypeBar.length > 0 ? prevRobotTypeBar : undefined}
                            prevLabel={prevLabel}
                        />
                    </div>

                    <div className={styles.chartCard}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#0e8ebf" }} />
                            <h3>시간 통계</h3>
                            <span className={styles.cellSum} style={{ color: "#4db8e8" }}>{timeHText.replace("h","")}<span>h</span> {timeMText.replace("m","")}<span>m</span></span>
                        </div>
                        <VerticalBarChart
                            items={timeBar} color="#0e8ebf"
                            prevItems={prevTimeBar.length > 0 ? prevTimeBar : undefined}
                            prevLabel={prevLabel}
                        />
                    </div>

                    <div className={styles.chartCard}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#77a251" }} />
                            <h3>작업 통계</h3>
                            <span className={styles.cellSum} style={{ color: "#92ca60" }}>{totalTasks}<span>건</span></span>
                        </div>
                        <DonutWithLegend
                            items={taskBar}
                            colors={["#6bcf4a", "#ff6b7a", "#a0a4b8"]}
                            centerLabel="성공률"
                            centerValue={`${statsSummary.taskSuccessRate}`}
                            centerUnit="%"
                            unit="건"
                            prevItems={prevTaskBar.length > 0 ? prevTaskBar : undefined}
                        />
                    </div>

                    <div className={styles.chartCard}>
                        <div className={styles.cellHead}>
                            <div className={styles.cellDot} style={{ background: "#c2434c" }} />
                            <h3>에러 통계</h3>
                            <span className={styles.cellSum} style={{ color: "#e06b73" }}>{totalErrors}<span>건</span></span>
                        </div>
                        <DonutWithLegend
                            items={errorBar}
                            colors={["#ff7085", "#ffb844", "#50c8f0", "#a0a4b8"]}
                            centerLabel="총 에러"
                            centerValue={totalErrors.toString()}
                            centerUnit="건"
                            unit="건"
                            prevItems={prevErrorBar.length > 0 ? prevErrorBar : undefined}
                        />
                    </div>
                </div>

                {/* Section 3: 기간 비교 */}
                {/* Section 3: 기간 비교 (로봇 → 운행 → 작업 → 에러) */}
                <div className={styles.comparisonRow}>
                    <ComparisonCard
                        title="로봇" color="#92d4f4" prevPeriodLabel={prevLabel}
                        delta={statsSummary.robotDelta !== null && statsSummary.robotDelta !== 0
                            ? { value: `${Math.abs(statsSummary.robotDelta)}대`, isUp: statsSummary.robotDelta > 0 } : null}
                        current={robotTypeBar.map(e => ({ label: e.label, value: `${e.value}` }))}
                        previous={prevRobotTypeBar.map(e => ({ label: e.label, value: `${e.value}` }))}
                    />
                    <ComparisonCard
                        title="시간" color="#0e8ebf" prevPeriodLabel={prevLabel}
                        tooltip="가동률 = 운행시간 / (운행+충전+대기) × 100"
                        delta={statsSummary.opDelta !== null && statsSummary.opDelta !== 0
                            ? { value: convertMinutesToText(Math.abs(statsSummary.opDelta)), isUp: statsSummary.opDelta > 0 } : null}
                        current={timeBar.map(e => ({ label: e.label, value: e.displayValue ?? `${e.value}` }))}
                        previous={prevTimeBar.map(e => ({ label: e.label, value: e.displayValue ?? `${e.value}` }))}
                    />
                    <ComparisonCard
                        title="작업" color="#77a251" prevPeriodLabel={prevLabel}
                        tooltip="성공률 = 완료 작업 / 총 작업 × 100"
                        delta={statsSummary.taskDelta !== null && statsSummary.taskDelta !== 0
                            ? { value: `${Math.abs(statsSummary.taskDelta)}건`, isUp: statsSummary.taskDelta > 0 } : null}
                        current={[
                            { label: "완료", value: `${statsSummary.completed}` },
                            { label: "실패", value: `${statsSummary.failed}` },
                            { label: "취소", value: `${statsSummary.cancelled}` },
                        ]}
                        previous={prevStatsData ? [
                            { label: "완료", value: `${prevStatsData.tasks.completed}` },
                            { label: "실패", value: `${prevStatsData.tasks.failed}` },
                            { label: "취소", value: `${prevStatsData.tasks.cancelled}` },
                        ] : []}
                    />
                    <ComparisonCard
                        title="에러" color="#c2434c" prevPeriodLabel={prevLabel}
                        tooltip="에러율 = 실패 작업 / 총 작업 × 100"
                        delta={statsSummary.errorDelta !== null && statsSummary.errorDelta !== 0
                            ? { value: `${Math.abs(statsSummary.errorDelta)}건`, isUp: statsSummary.errorDelta > 0 } : null}
                        current={errorBar.map(e => ({ label: e.label, value: `${e.value}` }))}
                        previous={prevErrorBar.map(e => ({ label: e.label, value: `${e.value}` }))}
                    />
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
