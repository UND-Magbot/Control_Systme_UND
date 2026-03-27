"use client";

import { useEffect, useState } from "react";
import styles from './dataManagement.module.css';
import RobotInfo from "@/app/lib/robotInfo";
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import VideoData from "@/app/lib/videoData";
import RobotTypeData from "@/app/lib/robotTypeData";
import getLogData from "@/app/lib/logData";
import getStatisticsData from "@/app/lib/statisticsData";
import VideoList from "./components/VideoList";


export default function DataPage() {

    const [robots, setRobots] = useState<any[]>([]);
    const [cameras, setCameras] = useState<any[]>([]);
    const [videoStatus, setVideoStatus] = useState<any[]>([]);
    const [videoData, setVideoData] = useState<any[]>([]);
    const [robotTypeData, setRobotTypeData] = useState<any[]>([]);
    const [logData, setLogData] = useState<any[]>([]);
    const [statisticsData, setStatisticsData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            RobotInfo(),
            cameraView(),
            VideoStatus(),
            VideoData(),
            RobotTypeData(),
            getLogData(),
            getStatisticsData()
        ]).then(([robots, cameras, videoStatus, videoData, robotTypeData, logData, statisticsData]) => {
            setRobots(robots);
            setCameras(cameras);
            setVideoStatus(videoStatus);
            setVideoData(videoData);
            setRobotTypeData(robotTypeData);
            setLogData(logData);
            setStatisticsData(statisticsData);
            setLoading(false);
        });
    }, []);

    if (loading) return null;

    return (
        <div className={styles.tabPosition}>
            <VideoList
                robots={robots}
                cameras={cameras}
                video={videoStatus}
                videoData={videoData}
                robotTypeData={robotTypeData}
                logData={logData}
                statisticsData={statisticsData}/>
        </div>
    )
}
