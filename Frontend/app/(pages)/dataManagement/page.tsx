import styles from './dataManagement.module.css';
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import VideoData from "@/app/lib/videoData";
import RobotTypeData from "@/app/lib/robotTypeData";
import getStatisticsData from "@/app/lib/statisticsData";
import VideoList from "./components/VideoList";

export default function DataPage() {
    return (
        <div className={styles.tabPosition}>
            <VideoList
                cameras={cameraView()}
                video={VideoStatus()}
                videoData={VideoData()}
                robotTypeData={RobotTypeData()}
                statisticsData={getStatisticsData()}
            />
        </div>
    )
}
