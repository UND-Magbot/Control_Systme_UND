import styles from './operationManagement.module.css';
import OperationManagementTabs from './components/OperationManagementTabs';
import PermissionGuard from "@/app/components/common/PermissionGuard";
import VideoStatus from '@/app/lib/videoStatus';
import PowerStatus from "@/app/lib/powerData";

export default function Page() {
    return (
        <PermissionGuard requiredPermissions={["robot-list", "business-list"]}>
            <div className={styles.tabPosition}>
                <OperationManagementTabs
                    cameras={[]}
                    video={VideoStatus()}
                    powerStatus={PowerStatus()}
                />
            </div>
        </PermissionGuard>
    )
}
