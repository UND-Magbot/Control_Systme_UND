import styles from './robots.module.css';
import RobotList from './components/RobotList';
import Floors from '@/app/lib/floorInfo';
import BatteryStatus from '@/app/lib/batteryData';
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import NetworkStatus from "@/app/lib/networkData";
import PowerStatus from "@/app/lib/powerData";
import LocationStatus from "@/app/lib/locationData";

export default function Page() {
    return (
        <div className={styles.tabPosition}>
            <RobotList
                cameras={cameraView()}
                floors={Floors()}
                video={VideoStatus()}
                batteryStatus={BatteryStatus()}
                networkStatus={NetworkStatus()}
                powerStatus={PowerStatus()}
                locationStatus={LocationStatus()}
            />
        </div>
    )
}
