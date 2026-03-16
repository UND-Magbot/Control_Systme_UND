import styles from './Schedules.module.css';
import WorkSchedule from '@/app/(pages)/schedules/components/WorkSchedule';
import RobotInfo from "@/app/lib/robotInfo";

export default async function Page() {

    const [robots] = await Promise.all([
        RobotInfo()
    ]);
  

    return (
      <>
        <div className={styles.topPosition}>
            <h1>Schedule Management</h1>
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
              <div className={styles.workLegend}>
                <div>[환] 환자 모니터링</div>
                <div>[순] 순찰/보안</div>
                <div>[운] 물품/약품 운반</div>
              </div>
            </div>
        </div>
        <WorkSchedule robots={robots} />
      </>
    )
}