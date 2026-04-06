"use client";

import { usePageReady } from "@/app/context/PageLoadingContext";
import styles from './dataManagement.module.css';
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import VideoData from "@/app/lib/videoData";
import RobotTypeData from "@/app/lib/robotTypeData";
import VideoList from "./components/VideoList";

export default function DataPage() {
    const setPageReady = usePageReady();

    return (
        <div className={styles.tabPosition}>
            <VideoList
                cameras={cameraView()}
                video={VideoStatus()}
                videoData={VideoData()}
                robotTypeData={RobotTypeData()}
                onDataReady={setPageReady}
            />
        </div>
    )
}
