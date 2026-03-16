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
import Link from "next/link";


export default async function DashboardPage() {


  const [robots, cameras, floors, videoStatus] = await Promise.all([
    RobotInfo(),
    cameraView(),
    Floors(),
    VideoStatus(),
  ]);
  
   return (
       <div className={styles["container-grid"]}>

         {/* Robot Real-time Camera */}
         <div className={styles["top-common-div"]}>
            <CameraSection cameras={cameras} robots={robots} video={videoStatus} />
         </div>

         {/* Robot Location */}
         <div className={styles["top-common-div"]}>
           <MapSection floors={floors} robots={robots} video={videoStatus} cameras={cameras}/>
        </div>


         {/* Robot Status */}
         <div className={`${styles["bottom-common-div"]}`}>
          <div className={styles["top-div"]}>
            <div className={styles["title-div"]}>
                 <div>
                     <img src="/icon/robot_status_w.png" alt="robot_status" />
                 </div>
                 <h2>로봇 상태</h2>
               </div>
               <Link href="/robots" className={styles.plusBtn}>+</Link>
           </div>
             <RobotStatusList robotRows={robots} />
         </div>


         {/* Notice & Alert */}
         <div className={`${styles["bottom-common-div"]} ${styles["notice"]}`}>
          <div className={styles["top-div"]}>
            <div className={styles["title-div"]}>
                 <div>
                   <img src="/icon/notice_w.png" alt="notice&Alert" />
                 </div>
                 <h2>알림 & 공지사항</h2>
               </div>
               <Link href="#" className={styles.plusBtn}>+</Link>
           </div>
          <NoticeList />
       </div>
     </div>
    );
}