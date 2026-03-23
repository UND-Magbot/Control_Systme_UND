import styles from './Schedules.module.css';
import WorkSchedule from '@/app/(pages)/schedules/components/WorkSchedule';
import RobotInfo from "@/app/lib/robotInfo";

export default async function Page() {

    const [robots] = await Promise.all([
        RobotInfo()
    ]);
  

    return (
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
      </div>
    )
}