import { Suspense } from "react";
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

export default async function Page() {

    const [robots, cameras, floors, videoStatus, batteryStatus, networkStatus, powerStatus, locationStatus] = await Promise.all([
        RobotInfo(),
        cameraView(),
        Floors(),
        VideoStatus(),
        BatteryStatus(),
        NetworkStatus(),
        PowerStatus(),
        LocationStatus()
    ]);

    let operating = 0;
    let standby = 0;
    let discharged = 0;
    let charging = 0;

    robots.forEach(r => {

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

    // 최종 전체 개수
    const total = robots.length;

    return (
        <>
        <div className={styles.tabPosition}>
            <div className={styles.topPosition} >
                <h1>Robot Management</h1>
                
                <div className={styles.countBox}>
                    <div className={styles.robotCount}>
                        <div className={styles.countItem}>
                            <div>Total</div>
                            <div className={styles.totalNumber}>{total}</div>
                        </div>
                        <div>|</div>
                        <div className={styles.countItem}>
                            <div>운영</div>
                            <div className={styles.itemNumber}>{operating}</div>
                        </div>
                        <div>|</div>
                        <div className={styles.countItem}>
                            <div>대기</div>
                            <div className={styles.itemNumber}>{standby}</div>
                        </div>
                        <div>|</div>
                        <div className={styles.countItem}>
                            <div>비운영</div>
                            <div className={styles.itemNumber}>{discharged}</div>
                        </div>
                    </div>
                    <div className={styles.batteryCount}>
                        <div>Battery</div>
                        <div className={styles.countItem}>
                            <div>방전</div>
                            <div className={styles.itemNumber}>{charging}</div>
                        </div>
                        <div>|</div>
                        <div className={styles.countItem}>
                            <div>충전</div>
                            <div className={styles.itemNumber}>{charging}</div>
                        </div>
                    </div>
                </div>
            </div>
            <Suspense fallback={null /* 또는 스켈레톤/로딩 */}>
                <RobotList 
                    robots={robots} 
                    cameras={cameras} 
                    floors={floors} 
                    video={videoStatus} 
                    batteryStatus={batteryStatus} 
                    networkStatus={networkStatus}
                    powerStatus={powerStatus} 
                    locationStatus={locationStatus}
                />
            </Suspense>
        </div>
        </>
    )
}