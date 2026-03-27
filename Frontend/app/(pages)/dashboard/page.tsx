import React from 'react';
import DashboardClient from "./components/DashboardClient";
import RobotInfo from "@/app/lib/robotInfo";
import Floors from '@/app/lib/floorInfo';
import VideoStatus from '@/app/lib/videoStatus';
import cameraView from "@/app/lib/cameraView";
import VideoData from "@/app/lib/videoData";

export default async function DashboardPage() {
  const [robots, cameras, floors, videoStatus, videoItems] = await Promise.all([
    RobotInfo(),
    cameraView(),
    Floors(),
    VideoStatus(),
    VideoData(),
  ]);

  return (
    <DashboardClient
      robots={robots}
      cameras={cameras}
      floors={floors}
      videoStatus={videoStatus}
      videoItems={videoItems}
    />
  );
}
