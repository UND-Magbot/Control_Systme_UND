import styles from './WaypointProgress.module.css';

export type WaypointStatus = "completed" | "current" | "pending" | "error";

export type WaypointStep = {
  name: string;
  status: WaypointStatus;
};

type WaypointProgressProps = {
  waypoints: WaypointStep[];
  /** 오류 발생 시 중단 메시지 */
  errorMessage?: string | null;
};

const DOT_ICON: Record<WaypointStatus, string> = {
  completed: "✓",
  current: "●",
  pending: "",
  error: "✕",
};

const DOT_CLASS: Record<WaypointStatus, string> = {
  completed: styles.dotCompleted,
  current: styles.dotCurrent,
  pending: styles.dotPending,
  error: styles.dotError,
};

const LABEL_CLASS: Record<WaypointStatus, string> = {
  completed: "",
  current: styles.labelCurrent,
  pending: "",
  error: styles.labelError,
};

/**
 * 두 스텝 사이의 연결선 색상을 결정
 * - 앞 스텝이 completed → 초록
 * - 앞 스텝이 current → 파랑
 * - 앞 스텝이 error → 빨강
 * - 그 외 → 회색
 */
function getLineClass(prevStatus: WaypointStatus): string {
  switch (prevStatus) {
    case "completed": return styles.lineCompleted;
    case "current":   return styles.lineCurrent;
    case "error":     return styles.lineError;
    default:          return styles.linePending;
  }
}

export default function WaypointProgress({ waypoints, errorMessage }: WaypointProgressProps) {
  if (!waypoints || waypoints.length === 0) {
    return (
      <div className={styles.placeholder}>
        경로 진행 상태는 API 연동 후 표시됩니다
      </div>
    );
  }

  const hasError = waypoints.some(w => w.status === "error");

  return (
    <div>
      <div className={styles.track}>
        {waypoints.map((wp, i) => (
          <div key={i} className={styles.step}>
            <div className={styles.stepRow}>
              {/* 연결선 (첫 번째 스텝 앞에는 없음) */}
              {i > 0 && (
                <div className={`${styles.line} ${getLineClass(waypoints[i - 1].status)}`} />
              )}
              {/* 점 */}
              <div className={`${styles.dot} ${DOT_CLASS[wp.status]}`}>
                {DOT_ICON[wp.status]}
              </div>
            </div>
            {/* 라벨 */}
            <span className={`${styles.label} ${LABEL_CLASS[wp.status]}`} title={wp.name}>
              {wp.name}
            </span>
          </div>
        ))}
      </div>
      {hasError && errorMessage && (
        <div className={styles.errorMessage}>{errorMessage}</div>
      )}
    </div>
  );
}
