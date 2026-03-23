import { Suspense } from "react";
import styles from './dataManagement.module.css';
import RobotInfo from "@/app/lib/robotInfo";
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import VideoData from "@/app/lib/videoData";
import RobotTypeData from "@/app/lib/robotTypeData";
import getLogData from "@/app/lib/logData";
import getStatisticsData from "@/app/lib/statisticsData";
import VideoList from "./components/VideoList";


export default async function DataPage() {

    const [robots, cameras, videoStatus, videoData, robotTypeData, logData, statisticsData] = await Promise.all([
        RobotInfo(),
        cameraView(),
        VideoStatus(),
        VideoData(),
        RobotTypeData(),
        getLogData(),
        getStatisticsData()
    ]);

    return (
        <div className={styles.tabPosition}>
            <Suspense fallback={null}>
                <VideoList
                    robots={robots}
                    cameras={cameras}
                    video={videoStatus}
                    videoData={videoData}
                    robotTypeData={robotTypeData}
                    logData={logData}
                    statisticsData={statisticsData}/>
            </Suspense>
        </div>
    )
}