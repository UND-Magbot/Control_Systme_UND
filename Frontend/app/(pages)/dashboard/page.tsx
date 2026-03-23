import React from 'react';
import styles from './dashboard.module.css';
import CameraSection from "./components/CameraSection";
import MapSection from "./components/MapSection";
import RobotStatusList from "./components/RobotStatusList";
import NoticeList from "./components/NoticeList";
import RobotInfo from "@/app/lib/robotInfo";
import Floors from '@/app/lib/floorInfo';
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import VideoData from "@/app/lib/videoData";
import Link from "next/link";
import SectionHeader from "./components/SectionHeader";


export default async function DashboardPage() {


  const [robots, cameras, floors, videoStatus, videoItems] = await Promise.all([
    RobotInfo(),
    cameraView(),
    Floors(),
    VideoStatus(),
    VideoData(),
  ]);
  
   return (
       <div className={styles["container-grid"]}>

         {/* Robot Real-time Camera */}
         <div className={styles["top-common-div"]}>
            <CameraSection cameras={cameras} robots={robots} video={videoStatus} videoItems={videoItems} />
         </div>

         {/* Robot Location */}
         <div className={styles["top-common-div"]}>
           <MapSection floors={floors} robots={robots} video={videoStatus} cameras={cameras}/>
        </div>


         {/* Robot Status */}
         <div className={`${styles["bottom-common-div"]}`}>
          <SectionHeader
            icon="/icon/robot_status_w.png"
            title="로봇 상태"
            rightSlot={<Link href="/robots" className={styles.moreLink}>더보기 ›</Link>}
          />
          <RobotStatusList robotRows={robots} />
         </div>


         {/* Notice & Alert */}
         <div className={`${styles["bottom-common-div"]} ${styles["notice"]}`}>
          <SectionHeader
            icon="/icon/notice_w.png"
            title="공지사항"
            rightSlot={<Link href="/alerts?tab=notice" className={styles.moreLink}>더보기 ›</Link>}
          />
          <NoticeList />
       </div>
     </div>
    );
}