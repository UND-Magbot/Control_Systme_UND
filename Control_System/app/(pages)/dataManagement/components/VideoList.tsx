"use client";

import React, { useState, useRef, useEffect } from 'react';
import styles from './VideoList.module.css';
import Pagination from "@/app/components/pagination";
import Calendar from "@/app/components/Calendar";
import type { RobotRowData, Camera, Video, VideoItem, Period, LogItem, RobotType } from '@/app/type';
import VideoPlayModal from '@/app/components/modal/VideoPlayModal';
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";
import TotalDonutChart from "./TotalDonutChart";
import ItemDonutChart from "./ItemDonutChart";
import { buildRobotTypeDonut, buildTaskCountDonut, buildTimeDonut, buildErrorDonut } from '../../../utils/Charts';

const PAGE_SIZE = 8;

type VideoListProps = {
  cameras: Camera[];
  robots: RobotRowData[];
  video: Video[];
  videoData: VideoItem[];
  robotTypeData: RobotType[];
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
    video, 
    robotTypeData, 
}:VideoListProps) {

    const [videoActiveIndex, setVideoActiveIndex] = useState<number | null>(null);
    const [robotActiveIndex, setRobotActiveIndex] = useState<number | null>(null);
    
    const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
    const [selectedRobot, setSelectedRobot] = useState<RobotRowData | null>(null);
    const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
    
    const [externalStartDate, setExternalStartDate] = useState<string | null>(null);
    const [externalEndDate, setExternalEndDate] = useState<string | null>(null);
    
    // 로봇 타입 선택 인덱스 (-1 = Total Robots)
    const [robotTypeActiveIndex, setRobotTypeActiveIndex] = useState<number>(-1);

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

    const [isVideoOpen, setIsVideoOpen] = useState(false);
    const [isRobotOpen, setIsRobotOpen] = useState(false);
    const [isRobotTypeOpen, setIsRobotTypeOpen] = useState(false);
    const videoWrapperRef = useRef<HTMLDivElement>(null);
    const robotWrapperRef = useRef<HTMLDivElement>(null);
    const robotTypeWrapperRef = useRef<HTMLDivElement>(null);

    
    // 탭별 페이지 상태
    const [videoPage, setVideoPage] = useState(1);
    const [dtPage, setDtPage] = useState(1);
    const [logPage, setLogPage] = useState(1);

    const logData:LogItem[] = [];

    // 현재 탭에 따라 참조할 데이터/페이지 선택
    let currentPage;
    let currentData;

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

            setVideoActiveIndex(-1);
            setRobotActiveIndex(-1);

        } else if (tab === "dt" && activeTab !== "dt") {
            setDtPage(1);

            // 로봇 이름/타입 선택 초기화
            setSelectedRobot(null);        // 로봇 이름 선택 초기화
            setRobotActiveIndex(-1);       // 로봇 이름 인덱스 초기화

            setSelectedRobotType(null);    // 로봇 타입 선택 초기화
            setRobotTypeActiveIndex(-1);   // 로봇 타입 인덱스 초기화
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
0            }
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

    // 그 위쪽 state 선언은 그대로 두고, 핸들러만 수정
    const videoStatusClick = (idx: number, option: Video) => {
        setVideoActiveIndex(idx);
        if (option.label === "Total") {
            setSelectedVideo(null);
        } else {
            setSelectedVideo(option);
        }
        setIsVideoOpen(false);
    };

    const robotStatusClick = (idx: number) => {
        setRobotActiveIndex(idx);

        if (idx === 0) {
            // Total 선택
            setSelectedRobot(null);
        } else {
            // 실제 로봇 데이터는 idx - 1
            setSelectedRobot(robots[idx - 1]);
        }

        setIsRobotOpen(false);
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
        setVideoActiveIndex(idx);
        setPlayedVideoId(videoData.id);
        setPlayedVideo(videoData);
        setVideoPlayModalOpen(true)

        console.log("선택된 로봇 (Location 클릭):", videoData.id, videoData.filename);
    };

    useEffect(() => {
        const handleOutsideClick = (e: MouseEvent) => {
          const target = e.target as Node;
      
          // 비디오 셀렉트 외부 클릭 → 닫기
          if (
            isVideoOpen &&
            videoWrapperRef.current &&
            !videoWrapperRef.current.contains(target)
          ) {
            setIsVideoOpen(false);
          }
      
          // 로봇 셀렉트 외부 클릭 → 닫기
          if (
            isRobotOpen &&
            robotWrapperRef.current &&
            !robotWrapperRef.current.contains(target)
          ) {
            setIsRobotOpen(false);
          }

          // 로봇 셀렉트 외부 클릭 → 닫기
          if (
            isRobotTypeOpen &&
            robotTypeWrapperRef.current &&
            !robotTypeWrapperRef.current.contains(target)
          ) {
            setIsRobotTypeOpen(false);
          }
        };
      
        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [isVideoOpen, isRobotOpen, isRobotTypeOpen]);


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

    
    const robotTypeColorMap: Record<string, string> = {
        QUADRUPED: "#fa0203",
        COBOT: "#03abf3",
        AMR: "#97ce4f",
        HUMANOID: "#f79418",
    };

    const filteredRobots = robots.filter((r) => {
        // 타입 선택됨 → 필터 적용
        if (selectedRobotType) {
            if (r.type !== selectedRobotType.label) return false;
        }

        // 로봇 선택됨 → 필터 적용
        if (selectedRobot) {
            if (r.id !== selectedRobot.id) return false;
        }

        return true;
    });

 
    const hasAnyFilter = !!selectedRobotType || !!selectedRobot;
    const baseRobots = hasAnyFilter ? filteredRobots : robots;

    const robotTypeDonut = buildRobotTypeDonut({ robots: robots   });
    const taskDonut = buildTaskCountDonut({ robots: baseRobots  });
    const timeDonut = buildTimeDonut({ robots: baseRobots  });
    const errorDonut = buildErrorDonut({ robots: baseRobots  });

    const totalRobots = robots.length;
    const FilterTotalUnits = baseRobots.length;

    const totalTasks  = taskDonut.reduce((s, i) => s + i.value, 0);
    const totalTimeMinutes = timeDonut.reduce((s, i) => s + i.value, 0);
    const totalTimeStr = convertMinutesToText(totalTimeMinutes); // 예: "498h 3m"
    const [hText, mText] = totalTimeStr.split(" "); // ["498h", "3m"]
    const totalErrors = errorDonut.reduce((s, i) => s + i.value, 0);


    // 로봇 이름 선택 (dt 탭)
    // Total Robots 클릭
    const handleRobotTotalClick = () => {
        setRobotActiveIndex(0);     // 0 = Total
        setSelectedRobot(null);     // 로봇 선택 해제
        setIsRobotOpen(false);
    };

    // 개별 로봇 선택
    const dtRobotClick = (idx: number, robot: RobotRowData) => {
        setRobotActiveIndex(idx);
        setSelectedRobot(robot);
        setIsRobotOpen(false);

        // ✅ 현재 선택된 로봇 타입 필터와 다른 타입이면 타입 필터 초기화
        if (selectedRobotType && selectedRobotType.label !== robot.type) {
            setSelectedRobotType(null);     // 타입 필터 제거
            setRobotTypeActiveIndex(0);     // 0 = Total Robots 로 되돌림
        }
    };

    // Robot Type = Total Robots 선택 시
    const handleRobotTypeTotalClick = () => {
        setRobotTypeActiveIndex(0);   // 0 = Total
        setSelectedRobotType(null);   // 타입 필터 해제
        setIsRobotTypeOpen(false);
    };

    // 특정 로봇 타입 선택 시
    const dtRobotTypeClick = (idx: number, type: RobotType) => {
        setRobotTypeActiveIndex(idx);   // 인덱스 저장
        setSelectedRobotType(type);     // 타입 필터 설정
        setIsRobotTypeOpen(false);

        // ✅ 이미 로봇이 선택돼 있는데, 타입이 다르면 로봇 선택 초기화
        if (selectedRobot && selectedRobot.type !== type.label) {
            setSelectedRobot(null);
            setRobotActiveIndex(0);       // 0 = Total Robots
        }
    };

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
    <div className={styles.videoListTab}>
        <div className={`${activeTab === "video" ? styles.active : ""}`} onClick={() => handleTabClick("video")}>녹화 영상</div>
        <div className={`${activeTab === "dt" ? styles.active : ""}`} onClick={() => handleTabClick("dt")}>통계 정보</div>
        <div className={`${activeTab === "log" ? styles.active : ""}`} onClick={() => handleTabClick("log")}>로그 이력</div>
    </div>

    {/* Recording Video 화면 */}
    {activeTab === "video" && (
        <div className={styles.videoList}>
            <div>    
                <div className={styles.videoListTopPosition}>
                    <h2>영상 목록</h2>
                    <div className={styles.videoSearch}>
                        <div className={styles.videoSelect}>
                            <div ref={videoWrapperRef}>
                                <div
                                    className={styles.selete}
                                    onClick={() => setIsVideoOpen(!isVideoOpen)}
                                >
                                    <span>
                                    {selectedVideo
                                        ? selectedVideo.label
                                        : videoActiveIndex === 0
                                        ? "Total"
                                        : "녹화 선택"}
                                    </span>
                                    {isVideoOpen ? (
                                    <img src="/icon/arrow_up.png" alt="arrow_up" />
                                    ) : (
                                    <img src="/icon/arrow_down.png" alt="arrow_down" />
                                    )}
                                </div>
                                {isVideoOpen && (
                                    <div className={`${styles.seletboxCommon} ${styles.videoSeletbox}`}>

                                    {/* 맨 위에 Total 추가 */}
                                    <div
                                        className={`${videoActiveIndex === 0 ? styles["active"] : ""}`.trim()}
                                        onClick={() => videoStatusClick(0, { id: 0, label: "Total" })}
                                    >
                                        Total
                                    </div>

                                    {/* 실제 video 옵션은 index + 1 오프셋 */}
                                    {video.map((item, idx) => (
                                        <div
                                        key={item.id}
                                        className={`${
                                            videoActiveIndex === idx + 1 ? styles["active"] : ""
                                        }`.trim()}
                                        onClick={() => videoStatusClick(idx + 1, item)}
                                        >
                                        {item.label}
                                        </div>
                                    ))}
                                    </div>
                                )}
                                </div>
                            <div ref={robotWrapperRef} >
                                <div className={styles.selete} 
                                    onClick={() => setIsRobotOpen(!isRobotOpen)}>
                                    <span>  {selectedRobot ? selectedRobot.no : robotActiveIndex === 0  ? "Total" : "로봇 선택"}</span>
                                    {isRobotOpen ? (
                                    <img src="/icon/arrow_up.png" alt="arrow_up" />
                                    ) : (
                                    <img src="/icon/arrow_down.png" alt="arrow_down" />
                                    )}
                                </div> 
                                {isRobotOpen && (
                                    <div className={`${styles.seletboxCommon} ${styles.robotSeletbox}`}>

                                        <div
                                            className={`${robotActiveIndex === 0 ? styles["active"] : ""}`.trim()}
                                            onClick={() => robotStatusClick(0)}
                                        >
                                            Total
                                        </div>

                                        {/* 실제 robots 데이터는 index + 1 로 오프셋 처리 */}
                                        {robots.map((robot, idx) => (
                                            <div
                                                key={robot.id}
                                                className={`${robotActiveIndex === idx + 1 ? styles["active"] : ""}`.trim()}
                                                onClick={() => robotStatusClick(idx + 1)}
                                            >
                                                {robot.no}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className={styles.videoPeriod}>
                        <div
                            className={`${styles.PeriodItemL} ${ selectedPeriod === "Total" ? styles.active : ""}`}
                            onClick={() => handlePeriodClick("Total")}
                        >
                            전체
                        </div>
                        <div
                            className={`${styles.PeriodItemLM} ${ selectedPeriod === '1week' ? styles.active : ''}`}
                            onClick={() => handlePeriodClick('1week')}
                        >
                            1주
                        </div>
                        <div
                            className={`${styles.PeriodItemMR} ${ selectedPeriod === '1month' ? styles.active : ''}`}
                            onClick={() => handlePeriodClick('1month')}
                        >
                            1달
                        </div>
                        <div
                            className={`${styles.PeriodItemR} ${selectedPeriod === '1year' ? styles.active : ''}`}
                            onClick={() => handlePeriodClick('1year')}
                        >
                            1년
                        </div>
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
                            <div >
                                <div className={styles.videoViewText}>
                                    <div className={styles.videoViewTopText}>
                                        <div className={`${styles.nameBox} ${styles.RobotCamNameBox}`}>{r.robotNo}</div>
                                        <div className={`${styles.nameBox} ${styles.RobotCamNameBox}`}>{r.cameraNo}</div>
                                        <div className={`${styles.nameBox} ${styles.videoNameBox}`}>
                                            <div className={styles.cameratypeIcon}></div>
                                            <div>{r.cameraType}</div>
                                        </div>
                                    </div>
                                    <div className={styles.videoExport} onClick={downloadSample}>
                                        <img src="/icon/download.png" alt="download" />
                                        <div>다운로드</div>
                                    </div>
                                </div>
                                <div className={styles.videoViewBottomText}>
                                    <div className={styles.videoTopTextColor}>{videoFormatDate(r.date)}</div>
                                    <div className={styles.videoTextColor}>{formatVideoTime(r.videoTime)}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>      
            <div className={styles.pagenationPosition}>
                <Pagination   totalItems={totalItems}
                currentPage={currentPage}
                onPageChange={getPageSetter()}
                pageSize={PAGE_SIZE}
                blockSize={5} />
            </div>
            <VideoPlayModal  isOpen={videoPlayModalOpen} onClose={() => setVideoPlayModalOpen(false)} playedVideoId={playedVideoId} playedVideo={playedVideo} />
        </div>
    )}

    {/* Statistical Info 화면 */}
    {activeTab === "dt" && (
        <div className={styles.DT}>
            <div className={styles.videoListTopPosition}>
                <h2>로봇 상태 통계</h2>
                <div className={styles.dtSearch}>
                    <div ref={robotTypeWrapperRef}>
                        <div
                            className={styles.selete}
                            onClick={() => setIsRobotTypeOpen(!isRobotTypeOpen)}
                        >
                            {/* 선택된 타입이 없으면 Total Robots 로 표시 */}
                            <span>{selectedRobotType ? selectedRobotType.label : robotTypeActiveIndex === 0  ? "Total" : "로봇 종류 선택"}</span>
                            {isRobotTypeOpen ? (
                            <img src="/icon/arrow_up.png" alt="arrow_up" />
                            ) : (
                            <img src="/icon/arrow_down.png" alt="arrow_down" />
                            )}
                        </div>

                        {isRobotTypeOpen && (
                            <div className={`${styles.seletboxCommon} ${styles.robotTypeSeletbox}`}>
                            {/* 맨 위에 Total Robots 추가 */}
                            <div
                                className={robotTypeActiveIndex === 0 ? styles.active : ''}
                                onClick={ () => {handleRobotTypeTotalClick()}}
                            >
                                Total
                            </div>

                            {/* 1 ~ : 각 타입 */}
                            {robotTypeData.map((type, idx) => (
                                <div
                                key={type.id}
                                className={robotTypeActiveIndex === idx + 1 ? styles.active : ''}
                                onClick={() => dtRobotTypeClick(idx + 1, type)}
                                >
                                {type.label}
                                </div>
                            ))}
                            </div>
                        )}
                    </div>
                    <div ref={robotWrapperRef} >
                        <div className={styles.selete} 
                            onClick={() => setIsRobotOpen(!isRobotOpen)}>
                            <span>{selectedRobot ? selectedRobot.no : robotActiveIndex === 0  ? "Total" : "로봇 이름 선택"}</span>
                            {isRobotOpen ? (
                            <img src="/icon/arrow_up.png" alt="arrow_up" />
                            ) : (
                            <img src="/icon/arrow_down.png" alt="arrow_down" />
                            )}
                        </div> 
                        {isRobotOpen && (
                            <div className={`${styles.seletboxCommon} ${styles.robotSeletbox}`}>

                                <div
                                    className={`${robotActiveIndex === 0 ? styles["active"] : ""}`.trim()}
                                    onClick={() => handleRobotTotalClick()}
                                >
                                    Total
                                </div>

                                {robots.map((robot, idx) => (
                                    <div
                                        key={robot.id}
                                        className={`${robotActiveIndex === idx + 1 ? styles["active"] : ""}`.trim()}
                                        onClick={() => { dtRobotClick(idx, robot) }}
                                    >
                                        {robot.no}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className={styles.donutContainerFlex}>
                <div className={styles.dtDonutLeftBox}>
                    <div className={styles.totalDonutCount}>
                        <div>Total Robots</div>
                        <div className={styles.totalCount}>{totalRobots} <span>units</span></div>
                    </div>
                    <div className={styles.leftChart}>
                        {/* 왼쪽 큰 도넛 - Total Robots */}
                        <TotalDonutChart
                            data={robotTypeDonut}
                            selectedRobotTypeLabel={selectedRobotType?.label ?? null}   // 로봇 종류 필터명
                            selectedRobotName={selectedRobot?.no ?? null}               // 로봇 이름 (Robot 5 등)
                            selectedRobotIconIndex={selectedRobot ? robots.findIndex(r => r.id === selectedRobot.id) : null}
                            FilterTotalUnits={FilterTotalUnits}
                        />
                    </div>
                    <div className={styles.robotTypeTotal}>
                    {robotTypeDonut.map((item) => {

                        const lower = item.label.toLowerCase();
                        
                        const hasTypeSelected = !!selectedRobotType; 
                        const hasRobotSelected = !!selectedRobot;

                        const isOnlyTypeSelected = hasTypeSelected && !hasRobotSelected;

                        // "활성 아이콘" 조건
                        const isActiveType =
                        (!hasTypeSelected && !hasRobotSelected) || 
                        (!hasRobotSelected && hasTypeSelected && selectedRobotType!.label === item.label) ||
                        (hasRobotSelected && selectedRobot!.type === item.label); 

                        // 타입만 선택된 경우 → 비활성 타입 숨김
                        if (hasTypeSelected && !hasRobotSelected && !isActiveType) {
                            return null;
                        }
                        
                        const iconSrc = isActiveType ? `/icon/${lower}-cg.png` : `/icon/${lower}-cg-w.png`;

                        // 비활성 텍스트 색상
                        const labelStyle = isActiveType ? undefined : { color: "#464a5d" };

                        const showCountBox =
                            (!hasRobotSelected && !hasTypeSelected) ||           // 초기
                            (!hasRobotSelected && hasTypeSelected && isActiveType); // 타입만 선택된 경우
                        
                        return (
                        <div key={item.id} className={styles.robotTypeOne}>
                            <div className={styles.robotTypeName}>
                                {isActiveType ? (
                                    <img src={iconSrc} alt={item.label} />
                                ) : (
                                    <div className={styles.robotTypeIconBox}>
                                        <img src={iconSrc} alt={item.label} />
                                    </div>
                                )}

                                <div className={styles.oneContentFs20} style={labelStyle}>
                                    {item.label}
                                </div>
                            </div>

                            {/* 로봇 이름 선택되면 count 박스 숨김 (이 규칙 그대로 유지) */}
                            {showCountBox && (
                            <div className={styles.oneContentCountBox}>
                                <div
                                className={styles.oneContentFs25}
                                style={{ color: robotTypeColorMap[item.label] }}
                                >
                                {item.percent.toFixed(1)}
                                <span>%</span>
                                </div>
                                <div className={styles.oneContentBar}>|</div>
                                <div className={styles.oneContentFs25}>
                                {item.value} <span className={styles.oneSpanColor}>units</span>
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
                            <ItemDonutChart title={"환자 모니터링"} data={[taskDonut[0]]} color="#77a251" />
                            <ItemDonutChart title={"순찰/보안"} data={[taskDonut[1]]} color="#77a251" />
                            <ItemDonutChart title={"물품/약품 운반"} data={[taskDonut[2]]} color="#77a251" />
                            <ItemDonutChart title={"점검"} data={[taskDonut[3]]} color="#77a251" />
                        </div>
                    </div>
                    <div className={styles.itemBoxBg}>
                        <div className={`${styles.itemTitleBox} ${styles.time}`}>
                            <h2>Time Stats</h2>
                            <div className={styles.itemDataTotal}>
                                <div className={styles.leftText}>Total</div>
                                <div className={`${styles.middleText} ${styles.timeTextColor}`}>{hText.replace("h", "")}<span>h</span></div>
                                <div className={`${styles.rightText} ${styles.timeTextColor}`}>{mText.replace("m", "")}<span>m</span></div>
                            </div>
                        </div>
                        <div className={styles.useItemDonutBox}>
                            <ItemDonutChart isTime title={"사용시간"} data={[timeDonut[0]]} color="#0e8ebf" />
                            <ItemDonutChart isTime title={"대기시간"} data={[timeDonut[1]]} color="#0e8ebf" />
                            <ItemDonutChart isTime title={"충전시간"} data={[timeDonut[2]]} color="#0e8ebf" />
                            <ItemDonutChart isTime title={"도킹시간"} data={[timeDonut[3]]} color="#0e8ebf" />
                        </div>
                    </div>
                    <div className={styles.itemBoxBg}>
                        <div className={styles.itemTitleBox}>
                            <h2>Error Stats</h2>
                            <div className={styles.itemDataTotal}>
                                <div className={styles.leftText}>Total</div>
                                <div className={`${styles.middleText} ${styles.errorTextColor}`}>{totalErrors}</div>
                                <div className={styles.rightText}>cases</div>
                            </div>
                        </div>
                        <div className={styles.useItemDonutBox}>
                            <ItemDonutChart title={"네트워크 에러"} data={[errorDonut[0]]} color="#c2434c" />
                            <ItemDonutChart title={"장애 에러"} data={[errorDonut[1]]} color="#c2434c" />
                            <ItemDonutChart title={"위치 에러"} data={[errorDonut[3]]} color="#c2434c" />
                            <ItemDonutChart title={"기타 에러"} data={[errorDonut[2]]} color="#c2434c" />
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
            <div className={styles.container}>
                <img src="/icon/coming-soon.png" alt="Coming Soon" />
                <div className={styles.topTitle}>COMING SOON</div>
                <div className={styles.contentText}>We Are Preparing This Service</div>
            </div>
            <div className={styles.pagenationPosition}>
                {/* <Pagination totalItems={totalItems} currentPage={currentPage} onPageChange={setCurrentPage} pageSize={PAGE_SIZE} blockSize={5} /> */}
            </div>
        </div>
    )}
    </>
  );
}