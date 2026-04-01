"use client";

import React, { useState, useEffect } from 'react';
import type { RobotRowData, Floor } from '@/app/type';
import WorkSchedule from './WorkSchedule';
import styles from '../Schedules.module.css';
import getRobots from "@/app/lib/robotInfo";

interface SchedulePageClientProps {
  floors: Floor[];
}

export default function SchedulePageClient({ floors }: SchedulePageClientProps) {
  const [robots, setRobots] = useState<RobotRowData[]>([]);

  useEffect(() => {
    getRobots().then(setRobots);
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>작업관리</h1>
        <div className={styles.legendContainer}>
          <div className={styles.statusLegend}>
            <div className={styles.statusItem}>
              <div className={`${styles.statusCircle} ${styles.waitingC}`}></div>
              <div>대기</div>
            </div>
            <div className={styles.statusItem}>
              <span className={`${styles.statusCircle} ${styles.workingC}`}></span>
              <span>작업중</span>
            </div>
            <div className={styles.statusItem}>
              <span className={`${styles.statusCircle} ${styles.errorC}`}></span>
              <span>작업중(오류)</span>
            </div>
            <div className={styles.statusItem}>
              <span className={`${styles.statusCircle} ${styles.completedC}`}></span>
              <span>작업완료</span>
            </div>
          </div>
        </div>
      </div>

      <WorkSchedule robots={robots} />
    </>
  );
}
