"use client";

import { useEffect, useState } from 'react';
import styles from './robots.module.css';
import RobotList from './components/RobotList';
import RobotInfo from "@/app/lib/robotInfo";
import Floors from '@/app/lib/floorInfo';
import BatteryStatus from '@/app/lib/batteryData';
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import NetworkStatus from "@/app/lib/networkData";
import PowerStatus from "@/app/lib/powerData";
import LocationStatus from "@/app/lib/locationData";

export default function Page() {

    const [robots, setRobots] = useState<any[]>([]);
    const [cameras, setCameras] = useState<any[]>([]);
    const [floors, setFloors] = useState<any[]>([]);
    const [videoStatus, setVideoStatus] = useState<any[]>([]);
    const [batteryStatus, setBatteryStatus] = useState<any[]>([]);
    const [networkStatus, setNetworkStatus] = useState<any[]>([]);
    const [powerStatus, setPowerStatus] = useState<any[]>([]);
    const [locationStatus, setLocationStatus] = useState<any[]>([]);
    const [robotStats, setRobotStats] = useState({ total: 0, operating: 0, standby: 0, discharged: 0, charging: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all([
            RobotInfo(),
            cameraView(),
            Floors(),
            VideoStatus(),
            BatteryStatus(),
            NetworkStatus(),
            PowerStatus(),
            LocationStatus()
        ]).then(([robots, cameras, floors, videoStatus, batteryStatus, networkStatus, powerStatus, locationStatus]) => {
            setRobots(robots);
            setCameras(cameras);
            setFloors(floors);
            setVideoStatus(videoStatus);
            setBatteryStatus(batteryStatus);
            setNetworkStatus(networkStatus);
            setPowerStatus(powerStatus);
            setLocationStatus(locationStatus);

            let operating = 0;
            let standby = 0;
            let discharged = 0;
            let charging = 0;

            robots.forEach((r: any) => {
                // 전원 OFF → 무조건 Discharged
                if (r.power === "Off") {
                    discharged++;
                    return;
                }

                // 충전 중 → Charging
                if (r.isCharging) {
                    charging++;
                    return;
                }

                // 작업 중 (작업 있음 + 대기 아님)
                if (r.tasks.length > 0 && r.waitingTime === 0) {
                    operating++;
                    return;
                }

                // 나머지는 Standby
                if (r.waitingTime > 0) {
                    standby++;
                    return;
                }
            });

            const total = robots.length;
            setRobotStats({ total, operating, standby, discharged, charging });
            setLoading(false);
        });
    }, []);

    if (loading) return null;

    return (
        <div className={styles.tabPosition}>
            <RobotList
                robots={robots}
                cameras={cameras}
                floors={floors}
                video={videoStatus}
                batteryStatus={batteryStatus}
                networkStatus={networkStatus}
                powerStatus={powerStatus}
                locationStatus={locationStatus}
                robotStats={robotStats}
            />
        </div>
    )
}
