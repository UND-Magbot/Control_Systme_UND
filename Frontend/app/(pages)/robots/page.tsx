import styles from './robots.module.css';
import RobotList from './components/RobotList';
import PermissionGuard from "@/app/components/common/PermissionGuard";
import Floors from '@/app/lib/floorInfo';
import BatteryStatus from '@/app/lib/batteryData';
import VideoStatus from '@/app/lib/videoStatus';
import NetworkStatus from "@/app/lib/networkData";
import PowerStatus from "@/app/lib/powerData";
import LocationStatus from "@/app/lib/locationData";

export default function Page() {
    return (
        <PermissionGuard requiredPermissions={["robot-list", "business-list"]}>
            <div className={styles.tabPosition}>
                <RobotList
                    cameras={[]}
                    floors={Floors()}
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
