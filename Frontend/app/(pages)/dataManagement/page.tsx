"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { usePageReady } from "@/app/context/PageLoadingContext";
import PermissionGuard from "@/app/components/common/PermissionGuard";
import styles from './dataManagement.module.css';
import VideoStatus from '@/app/lib/videoStatus';
import getVideoInfo from "@/app/lib/videoData";
import RobotTypeData from "@/app/lib/robotTypeData";
import VideoList from "./components/VideoList";
import type { VideoItem } from "@/app/type";

export default function DataPage() {
    const setPageReady = usePageReady();
    const searchParams = useSearchParams();
    const initialTab = searchParams.get('tab') as "video" | "dt" | "log" | null;
    const initialSearch = searchParams.get('search') || '';
    const [videoData, setVideoData] = useState<VideoItem[]>([]);

    useEffect(() => {
        getVideoInfo().then((res) => setVideoData(res.items));
    }, []);

    return (
        <PermissionGuard requiredPermissions={["video", "statistics", "log"]}>
            <div className={styles.tabPosition}>
                <VideoList
                    cameras={[]}
                    video={VideoStatus()}
                    videoData={videoData}
                    robotTypeData={RobotTypeData()}
                    onDataReady={setPageReady}
                    initialTab={initialTab || undefined}
                    initialSearch={initialSearch}
                />
            </div>
        </PermissionGuard>
    )
}
