"use client";

import React, { useState, useEffect, useMemo } from 'react';
import styles from './VideoList.module.css';
import Pagination from "@/app/components/pagination";
import Calendar from "@/app/components/Calendar";
import type { RobotRowData, Camera, Video, VideoItem, Period, LogItem, RobotType, DonutCommonInfo } from '@/app/type';
import VideoPlayModal from '@/app/components/modal/VideoPlayModal';
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";
import TotalDonutChart from "./TotalDonutChart";
import ItemDonutChart from "./ItemDonutChart";
import { buildRobotTypeDonut, buildTaskCountDonut, buildTimeDonut, buildErrorDonut } from '../../../utils/Charts';
import LogList from "./LogList";
import FilterSelectBox from "@/app/components/button/FilterSelectBox";

const PAGE_SIZE = 8;

type VideoListProps = {
  cameras: Camera[];
  robots: RobotRowData[];
  statisticsData: RobotRowData[];
  video: Video[];
  videoData: VideoItem[];
  robotTypeData: RobotType[];
  logData: LogItem[];
}

// 오늘 날짜만 필터하는 유틸
const filterTodayVideos = (videoData: VideoItem[]) => {
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);

  const end = new Date(today);
  end.setHours(23, 59, 59, 999);

  return videoData.filter((item) => {
    const itemDate = new Date(item.date);
    if (isNaN(itemDate.getTime())) return false;
    return itemDate >= start && itemDate <= end;
  });
};


export default function VideoList({
    videoData,
    robots,
    statisticsData,
    video,
    robotTypeData,
    logData,
}:VideoListProps) {

    const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
    const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);

    const [externalStartDate, setExternalStartDate] = useState<string | null>(null);
    const [externalEndDate, setExternalEndDate] = useState<string | null>(null);

    // 선택된 로봇 타입 (Total Robots = null)
    const [selectedRobotType, setSelectedRobotType] = useState<RobotType | null>(null);

    // 기본값 "당일 영상"
    const [searchFilterData, setSearchFilterData] = useState<VideoItem[] | null>(
      () => filterTodayVideos(videoData)
    );
    
    const [videoPlayModalOpen, setVideoPlayModalOpen] = useState(false);
    const [playedVideoId, setPlayedVideoId] = useState<number | null>(null);
    const [playedVideo, setPlayedVideo] = useState<VideoItem | null>(null);
    const [videoThumbnail, setVideoThumbnail] = useState<string | null>(null);

    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [activeTab, setActiveTab] = useState<"video" | "dt" | "log">("video");



    // 탭별 페이지 상태
    const [videoPage, setVideoPage] = useState(1);
    const [dtPage, setDtPage] = useState(1);
    const [logPage, setLogPage] = useState(1);

    // 현재 탭에 따라 참조할 데이터/페이지 선택
    let currentPage: number;
    let currentData: unknown[];

    switch (activeTab) {
    case "video":
        currentPage = videoPage;
        currentData = searchFilterData === null ? videoData : searchFilterData; // 전체보기
        break;
    case "dt":
        currentPage = dtPage;
        currentData = robots;
        break;
    case "log":
        currentPage = logPage;
        currentData = logData;
        break;
    }

    // 현재 탭 기준으로 totalItems 계산
    const totalItems = currentData.length;
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const currentItems = currentData.slice(startIndex, startIndex + PAGE_SIZE);

    // video 탭에서 사용할 전용 배열 (타입을 VideoItem[] 으로 고정)
    const videoCurrentItems: VideoItem[] =
    activeTab === "video" ? (currentItems as VideoItem[]) : [];

    const handleTabClick = (tab: "video" | "dt" | "log") => {
        setActiveTab(tab);
    
        if (tab === "video" && activeTab !== "video") {
            setVideoPage(1);

            // 필터 상태 초기화
            setSelectedVideo(null);
            setSelectedRobot(null);

            // 리스트 당일 기준
            setSearchFilterData(filterTodayVideos(videoData));

            // 달력 당일 기준
            const today = new Date();
            const todayStr = periodFormatDate(today);
            setExternalStartDate(todayStr);
            setExternalEndDate(todayStr);

            setSelectedPeriod(null);

        } else if (tab === "dt" && activeTab !== "dt") {
            setDtPage(1);

            // 로봇 이름/타입 선택 초기화
            setSelectedRobot(null);
            setSelectedRobotType(null);
        } else if (tab === "log") {
            setLogPage(1);
        }
    };

    const getPageSetter = () => {
        switch (activeTab) {
            case "video":
                return setVideoPage;
            case "dt":
                return setDtPage;
            case "log":
                return setLogPage;
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

    // 기간 버튼 클릭 처리 (전체 / 1주 / 1달 / 1년)
    const handlePeriodClick = (period: Period | null) => {
        setSelectedPeriod(period);

        const today = new Date();

        // 전체(= period === null)일 때
        if (period === "Total") {
            const earliest = getEarliestVideoDate();

            if (earliest) {
                // 캘린더에 "처음 데이터 날짜 ~ 오늘"로 표시되도록 전달
                setExternalStartDate(periodFormatDate(earliest));
                setExternalEndDate(periodFormatDate(today));
            } else {
                // 데이터 없을 때 안전 처리
                setExternalStartDate(null);
                setExternalEndDate(null);
            }
            return;
        }

        // 1주 / 1달 / 1년
        const start = new Date(today);

        if (period === "1week") {
            start.setDate(start.getDate() - 7);
        } else if (period === "1month") {
            start.setMonth(start.getMonth() - 1);
        } else if (period === "1year") {
            start.setFullYear(start.getFullYear() - 1);
        }
        // 'today'는 start = today 유지

        setExternalStartDate(periodFormatDate(start));
        setExternalEndDate(periodFormatDate(today));
    };

    const formatVideoTime = (time: string) => {
        const [hh, mm, ss] = time.split(":").map(Number);
    
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

    useEffect(() => {
    setSearchFilterData(filterTodayVideos(videoData));

    const today = new Date();
    const todayStr = periodFormatDate(today);
    setExternalStartDate(todayStr);
    setExternalEndDate(todayStr);
    }, [videoData]);

    
    useEffect(() => {
        // 비디오 타입/로봇 선택이 바뀔 때마다 1페이지로 이동
        setVideoPage(1);
    }, [selectedVideo, selectedRobot]);

    useEffect(() => {
        // DT 탭 필터 변경 시 1페이지로 이동
        if (activeTab === "dt") {
            setDtPage(1);
        }
    }, [selectedRobotType]);

    useEffect(() => {
        // 필터 적용 후 현재 페이지가 범위를 초과하면 1페이지로 리셋
        const maxPage = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
        if (currentPage > maxPage) {
            getPageSetter()(1);
        }
    }, [totalItems]);


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

    // ── 통계 데이터 필터 (statisticsData 기반) ──
    const filteredStatistics = statisticsData.filter((r) => {
        if (selectedRobotType) {
            if (r.type !== selectedRobotType.label) return false;
        }
        if (selectedRobot) {
            if (r.id !== selectedRobot.id) return false;
        }
        return true;
    });

    const hasAnyFilter = !!selectedRobotType || !!selectedRobot;
    const baseStatistics = hasAnyFilter ? filteredStatistics : statisticsData;

    const emptyDonut: DonutCommonInfo = { id: 0, label: "", value: 0, percent: 0, displayValue: "0" };

    const robotTypeDonut = buildRobotTypeDonut({ robots: statisticsData });
    const taskDonut = buildTaskCountDonut({ robots: baseStatistics });
    const timeDonut = buildTimeDonut({ robots: baseStatistics });
    const errorDonut = buildErrorDonut({ robots: baseStatistics });

    const totalRobots = statisticsData.length;
    const FilterTotalUnits = baseStatistics.length;

    const totalTasks  = taskDonut.reduce((s, i) => s + i.value, 0);
    const totalTimeMinutes = timeDonut.reduce((s, i) => s + i.value, 0);
    const totalTimeStr = convertMinutesToText(totalTimeMinutes);
    const parts = totalTimeStr.split(" ");
    const hText = parts[0] ?? "0h";
    const mText = parts[1] ?? "0m";
    const totalErrors = errorDonut.reduce((s, i) => s + i.value, 0);


    // 영상 다운로드(임시)
    const downloadSample = () => {
        const a = document.createElement("a");
        a.href = "/videos/control_system_sample.mp4";
        a.download = "control_system_sample.mp4"; // 저장 파일명
        document.body.appendChild(a);
        a.click();
        a.remove();
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
                                width={140}
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
                                width={140}
                            />
                        </div>
                        <div className={styles.videoPeriod}>
                            {([
                                { key: "Total", label: "전체" },
                                { key: "1week", label: "1주" },
                                { key: "1month", label: "1달" },
                                { key: "1year", label: "1년" },
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
                        <Calendar videoData={videoData}
                                  selectedVideo={selectedVideo}
                                  selectedRobot={selectedRobot}
                                  onFilteredChange={setSearchFilterData}
                                  selectedPeriod={selectedPeriod}
                                  onChangePeriod={setSelectedPeriod}
                                  externalStartDate={externalStartDate}
                                  externalEndDate={externalEndDate}
                        />
                    </div>
                </div>
                <div className={styles.contentArea}>
                    {videoCurrentItems.length === 0 ? (
                        <div className={styles.emptyState}>
                            <span>{searchFilterData !== null ? "조건에 맞는 영상이 없습니다" : "녹화된 영상이 없습니다"}</span>
                        </div>
                    ) : (
                        <div className={styles.videoViewContainer}>
                            {videoCurrentItems.map((r, idx) => (
                                <div key={r.id} className={styles.videoViewItem}>
                                    {videoThumbnail && (
                                        <div className={styles.videoViewBox} onClick={() => { VideoPlayClick(idx, r) }}>
                                            <div className={styles.videoView}>
                                                <img src={videoThumbnail} alt="thumbnail" />
                                            </div>
                                            <div className={styles.videoViewIcon} onMouseEnter={() => setHoveredIndex(idx)} onMouseLeave={() => setHoveredIndex(null)}>
                                                <img src={ hoveredIndex === idx ? `/icon/video_hover_icon.png` : `/icon/video_icon.png`} alt="play" />
                                            </div>
                                        </div>
                                    )}
                                    <div className={styles.videoMeta}>
                                        <div className={styles.metaRow1}>
                                            <span className={styles.metaPrimary}>{r.robotNo} · {r.cameraNo}</span>
                                            <div className={styles.videoExport} onClick={downloadSample}>
                                                <img src="/icon/download.png" alt="download" />
                                                <span>다운로드</span>
                                            </div>
                                        </div>
                                        <div className={styles.metaRow2}>
                                            <span className={styles.metaType}>
                                                <span className={styles.cameratypeIcon}></span>
                                                {r.cameraType}
                                            </span>
                                            <span className={styles.metaDot}>·</span>
                                            <span>{videoFormatDate(r.date)}</span>
                                            <span className={styles.metaDot}>·</span>
                                            <span className={styles.metaAccent}>{formatVideoTime(r.videoTime)}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            <div className={styles.pagenationPosition}>
                <Pagination   totalItems={totalItems}
                currentPage={currentPage}
                onPageChange={getPageSetter()}
                pageSize={PAGE_SIZE}
                blockSize={5} />
            </div>
            <VideoPlayModal isOpen={videoPlayModalOpen} onClose={() => setVideoPlayModalOpen(false)} playedVideo={playedVideo} />
        </div>
    )}

    {/* Statistical Info 화면 */}
    {activeTab === "dt" && (
        <div className={styles.DT}>
            {statisticsData.length === 0 && (
                <div className={styles.emptyNotice}>
                    현재 등록된 로봇이 없어 통계 데이터가 비어 있습니다
                </div>
            )}
            <div className={styles.videoListTopPosition}>
                <h2>통계 관리</h2>
                <div className={styles.dtSearch}>
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
                                    if (selectedRobot && selectedRobot.type !== type.label) {
                                        setSelectedRobot(null);
                                    }
                                }
                            } else {
                                setSelectedRobotType(null);
                            }
                        }}
                        width={140}
                    />
                    <FilterSelectBox
                        items={robotNameItems}
                        selectedLabel={selectedRobot?.no ?? null}
                        placeholder="로봇 명"
                        showTotal={robots.length > 0}
                        onSelect={(item) => {
                            if (item) {
                                // 통계 데이터에서 매칭 (차트 필터용)
                                const statRobot = statisticsData.find(r => r.no === item.label);
                                // robots API에서 매칭 (통계 데이터에 없는 경우 대비)
                                const apiRobot = robots.find(r => r.no === item.label);
                                const target = statRobot ?? apiRobot ?? null;
                                if (target) {
                                    setSelectedRobot(target);
                                    if (selectedRobotType && selectedRobotType.label !== target.type) {
                                        setSelectedRobotType(null);
                                    }
                                }
                            } else {
                                setSelectedRobot(null);
                            }
                        }}
                        width={140}
                    />
                </div>
            </div>

            <div className={styles.donutContainerFlex}>
                <div className={styles.dtDonutLeftBox}>
                    <div className={styles.leftChart}>
                        <TotalDonutChart
                            data={robotTypeDonut}
                            selectedRobotTypeLabel={selectedRobotType?.label ?? null}
                            selectedRobotName={selectedRobot?.no ?? null}
                            selectedRobotIconIndex={selectedRobot ? statisticsData.findIndex(r => r.id === selectedRobot.id) : null}
                            FilterTotalUnits={FilterTotalUnits}
                        />
                    </div>
                    <div className={styles.robotTypeTotal}>
                        <div className={styles.legendHeader}>
                            <span className={styles.legendTitle}>전체</span>
                            <span className={styles.legendCount}>{totalRobots}<span>units</span></span>
                        </div>
                    {robotTypeDonut.map((item) => {
                        const lower = item.label.toLowerCase();
                        const hasTypeSelected = !!selectedRobotType;
                        const hasRobotSelected = !!selectedRobot;
                        const color = robotTypeColorMap[item.label] ?? "#5d6174";

                        const isActiveType =
                            (!hasTypeSelected && !hasRobotSelected) ||
                            (!hasRobotSelected && hasTypeSelected && selectedRobotType!.label === item.label) ||
                            (hasRobotSelected && selectedRobot!.type === item.label);

                        if (hasTypeSelected && !hasRobotSelected && !isActiveType) {
                            return null;
                        }

                        const iconSrc = isActiveType ? `/icon/${lower}-cg.png` : `/icon/${lower}-cg-w.png`;
                        const isInactive = !isActiveType;
                        const showCountBox =
                            (!hasRobotSelected && !hasTypeSelected) ||
                            (!hasRobotSelected && hasTypeSelected && isActiveType);

                        return (
                        <div key={item.id} className={`${styles.robotTypeOne} ${isInactive ? styles.robotTypeInactive : ""}`}>
                            <div className={styles.robotTypeName}>
                                <div className={styles.colorDot} style={{ backgroundColor: isActiveType ? color : "#464a5d" }} />
                                <div className={styles.oneContentFs20} style={isInactive ? { color: "#464a5d" } : undefined}>
                                    {robotTypeKorMap[item.label] ?? item.label}
                                </div>
                            </div>
                            {showCountBox && (
                            <div className={styles.oneContentCountBox}>
                                <div className={styles.legendPercent} style={{ color }}>
                                    {item.percent.toFixed(1)}<span>%</span>
                                </div>
                                <div className={styles.legendDivider} />
                                <div className={styles.legendValue}>
                                    {item.value}<span>units</span>
                                </div>
                            </div>
                            )}
                        </div>
                        );
                    })}
                    </div>
                </div>
                <div className={styles.dtDonutRightBox}>
                    <div className={styles.itemBoxBg}>
                        <div className={styles.itemTitleBox}>
                            <h2>작업 통계</h2>
                            <div className={styles.itemDataTotal}>
                                <div className={styles.leftText}>Total</div>
                                <div className={`${styles.middleText} ${styles.taskTextColor}`}>{totalTasks}</div>
                                <div className={styles.rightText}>cases</div>
                            </div>
                        </div>
                        <div className={styles.useItemDonutBox}>
                            <ItemDonutChart title={"task1"} data={[taskDonut[0] ?? emptyDonut]} color="#77a251" />
                            <ItemDonutChart title={"task2"} data={[taskDonut[1] ?? emptyDonut]} color="#77a251" />
                            <ItemDonutChart title={"task3"} data={[taskDonut[2] ?? emptyDonut]} color="#77a251" />
                            <ItemDonutChart title={"task4"} data={[taskDonut[3] ?? emptyDonut]} color="#77a251" />
                        </div>
                    </div>
                    <div className={styles.itemBoxBg}>
                        <div className={`${styles.itemTitleBox} ${styles.time}`}>
                            <h2>시간 통계</h2>
                            <div className={styles.itemDataTotal}>
                                <div className={styles.leftText}>Total</div>
                                <div className={`${styles.middleText} ${styles.timeTextColor}`}>{hText.replace("h", "")}<span>h</span></div>
                                <div className={`${styles.rightText} ${styles.timeTextColor}`}>{mText.replace("m", "")}<span>m</span></div>
                            </div>
                        </div>
                        <div className={styles.useItemDonutBox}>
                            <ItemDonutChart isTime title={"사용시간"} data={[timeDonut[0] ?? emptyDonut]} color="#0e8ebf" />
                            <ItemDonutChart isTime title={"대기시간"} data={[timeDonut[1] ?? emptyDonut]} color="#0e8ebf" />
                            <ItemDonutChart isTime title={"충전시간"} data={[timeDonut[2] ?? emptyDonut]} color="#0e8ebf" />
                            <ItemDonutChart isTime title={"도킹시간"} data={[timeDonut[3] ?? emptyDonut]} color="#0e8ebf" />
                        </div>
                    </div>
                    <div className={styles.itemBoxBg}>
                        <div className={styles.itemTitleBox}>
                            <h2>에러 통계</h2>
                            <div className={styles.itemDataTotal}>
                                <div className={styles.leftText}>Total</div>
                                <div className={`${styles.middleText} ${styles.errorTextColor}`}>{totalErrors}</div>
                                <div className={styles.rightText}>cases</div>
                            </div>
                        </div>
                        <div className={styles.useItemDonutBox}>
                            <ItemDonutChart title={"네트워크"} data={[errorDonut[0] ?? emptyDonut]} color="#c2434c" />
                            <ItemDonutChart title={"장애"} data={[errorDonut[1] ?? emptyDonut]} color="#c2434c" />
                            <ItemDonutChart title={"위치"} data={[errorDonut[3] ?? emptyDonut]} color="#c2434c" />
                            <ItemDonutChart title={"기타"} data={[errorDonut[2] ?? emptyDonut]} color="#c2434c" />
                        </div>
                    </div>
                </div>
            </div>

            <div className={styles.pagenationPosition}>
                {/* <Pagination totalItems={totalItems} currentPage={currentPage} onPageChange={setCurrentPage} pageSize={PAGE_SIZE} blockSize={5} /> */}
            </div>
        </div>
    )}


    {/* Log History 화면 */}
    {activeTab === "log" && (
        <div className={styles.DT}>
            <LogList logData={logData} />
        </div>
    )}
    </>
  );
}