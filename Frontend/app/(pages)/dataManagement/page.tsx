"use client";

import { useSearchParams } from "next/navigation";
import { usePageReady } from "@/app/context/PageLoadingContext";
import PermissionGuard from "@/app/components/common/PermissionGuard";
import styles from './dataManagement.module.css';
import VideoStatus from '@/app/lib/videoStatus';
import RobotTypeData from "@/app/lib/robotTypeData";
import DataManagementTabs from "./components/DataManagementTabs";

export default function DataPage() {
    const setPageReady = usePageReady();
    const searchParams = useSearchParams();
    const initialTab = searchParams.get('tab') as "video" | "dt" | "log" | null;
    const initialSearch = searchParams.get('search') || '';

    return (
        <PermissionGuard requiredPermissions={["video", "statistics", "log"]}>
            <div className={styles.tabPosition}>
                <DataManagementTabs
                    video={VideoStatus()}
                    robotTypeData={RobotTypeData()}
                    onDataReady={setPageReady}
                    initialTab={initialTab || undefined}
                    initialSearch={initialSearch}
                />
            </div>
        </PermissionGuard>
    )
}
