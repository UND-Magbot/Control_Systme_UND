import styles from './robots.module.css';
import RobotList from './components/RobotList';
import PermissionGuard from "@/app/components/common/PermissionGuard";
import getFloors from '@/app/lib/floorInfo';
import BatteryStatus from '@/app/lib/batteryData';
import VideoStatus from '@/app/lib/videoStatus';
import NetworkStatus from "@/app/lib/networkData";
import PowerStatus from "@/app/lib/powerData";
import LocationStatus from "@/app/lib/locationData";

export default async function Page() {
    const floors = await getFloors();
    return (
        <PermissionGuard requiredPermissions={["robot-list", "business-list"]}>
            <div className={styles.tabPosition}>
                <RobotList
                    cameras={[]}
                    floors={floors}
                    video={VideoStatus()}
                    batteryStatus={BatteryStatus()}
                    networkStatus={NetworkStatus()}
                    powerStatus={PowerStatus()}
                    locationStatus={LocationStatus()}
                />
            </div>
        </PermissionGuard>
    )
}
