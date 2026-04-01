import React from 'react';
import DashboardClient from "./components/DashboardClient";
import Floors from '@/app/lib/floorInfo';
import VideoStatus from '@/app/lib/videoStatus';

export default function DashboardPage() {
  return (
    <DashboardClient
      floors={Floors()}
      videoStatus={VideoStatus()}
    />
  );
}
