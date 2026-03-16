"use client";

import type { DonutCommonInfo } from "@/app/type";
import { buildSingleDonutGradient } from "@/app/utils/buildSingleDonutGradient";
import styles from "./ItemDonutChart.module.css";

type Props = {
  title:React.ReactNode;
  data: DonutCommonInfo[];
  color: string;
  isTime?: boolean;
};

export default function RightDonutChart({ title, data, color, isTime }: Props) {
  const percent = data[0]?.percent ?? 0;
  const percentStr = Number(percent).toFixed(1);  // "12.3"
  const [intPart, decimalRaw] = percentStr.split(".");
  const decimalPart = decimalRaw?.[0] ?? "0"; // 첫째 자리만 사용

  const display = data[0]?.displayValue ?? "";
  const backgroundImage = buildSingleDonutGradient(percent, color);

  // "Operating Time", "Standby Time", "Charging Time" 같은 애들만 h/m 분리
  const isTimeChart = Boolean(isTime);

  let hour = "";
  let minute = "";

  if (isTimeChart && display) {
    // 예: display = "298h 42m"
    const [hText, mText] = display.split(" "); // ["298h", "42m"]
    hour = hText?.replace("h", "") ?? "0";
    minute = mText?.replace("m", "") ?? "0";
  }

  return (
    <div className={styles.itemDonutContainer}>
      <div className={styles.leftFlexBox}>
        <div className={styles.itemDonutTitle}>{title}</div>
          {/* Time일 때만 h/m 분리, 그 외엔 기존처럼 display 그대로 */}
          {isTimeChart ? (
            <div className={styles.itemDonutValue}>
              <div className={styles.itemHourValue}>{hour}<span>h</span></div>
              <div className={styles.itemMinuteValue}>{minute}<span>m</span></div>
            </div>
          ) : (
            <div className={styles.itemDonutValue}>
               <div className={styles.itemDataValue}>{display} <span>cases</span></div>
            </div>
          )}
      </div>
      <div className={styles.totalDonut}>
        {/* 바깥 컬러 도넛 */}
        <div className={styles.totalDonutOuter} style={{ backgroundImage }}>
            {/* 안쪽 어두운 링 + 중앙 원 */}
            <div className={styles.totalDonutInner}>
              <div className={styles.totalDonutCenter}>
                  <div className={styles.centerNumber}>{intPart}</div>
                  <div className={styles.centerUnit}>.<span>{decimalPart}</span>%</div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}