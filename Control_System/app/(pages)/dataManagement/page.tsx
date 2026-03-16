import styles from './dataManagement.module.css';
import RobotInfo from "@/app/lib/robotInfo";
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import VideoData from "@/app/lib/videoData";
import RobotTypeData from "@/app/lib/robotTypeData";
import VideoList from "./components/VideoList";


export default async function DataPage() {

    const [robots, cameras, videoStatus, videoData, robotTypeData] = await Promise.all([
        RobotInfo(),
        cameraView(),
        VideoStatus(),
        VideoData(),
        RobotTypeData()
    ]);

    return (
        <div className={styles.tabPosition}>
            <div className={styles.topPosition} >
                <h1>Data Management</h1>
            </div>
            <VideoList 
                robots={robots}
                cameras={cameras}
                video={videoStatus}
                videoData={videoData}
                robotTypeData={robotTypeData}/>
        </div>
    )
}