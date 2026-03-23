"use client";

import type { DonutCommonInfo } from "@/app/type";
import { buildConicGradient, DEFAULT_BACKGROUND_COLOR } from "@/app/utils/buildConicGradient";
import styles from "./TotalDonutChart.module.css";

const robotTypeKorMap: Record<string, string> = {
  QUADRUPED: "4족 보행",
  COBOT: "협동 로봇",
  AMR: "자율주행",
  HUMANOID: "휴머노이드",
};

type DonutChartProps = {
  data: DonutCommonInfo[];

  selectedRobotTypeLabel?: string | null;
  selectedRobotName?: string | null;
  selectedRobotIconIndex?: number | null;
  FilterTotalUnits?: number;
};

export default function DonutChart({ 
  data,
  selectedRobotTypeLabel,
  selectedRobotName,
  selectedRobotIconIndex,
  FilterTotalUnits
  
 }: DonutChartProps) {
  if (!data || data.length === 0) return null;

  const totalUnits = data.reduce((sum, item) => sum + item.value, 0);
  const ICON_COUNT = 6;

  // 1) null/undefined 이면 0으로 처리
  // 2) 로봇이 선택 안 되어 있으면 무조건 0으로 (기본 아이콘)
  const rawIndex = selectedRobotName ? (selectedRobotIconIndex ?? 0) : 0;

  // 3) 0 ~ ICON_COUNT-1 로 루프
  const iconIndex = rawIndex % ICON_COUNT;

  // 4) 파일명은 1부터 시작하니까 +1
  const iconNumber = iconIndex + 1;

  const robotTypeColorMap: Record<string, string> = {
      QUADRUPED: "#fa0203",
      COBOT: "#03abf3",
      AMR: "#97ce4f",
      HUMANOID: "#f79418",
  };

  const singleType = data.length === 1 ? data[0].label : null;

  const hasRobotNameFilter = !!selectedRobotName;
  const hasTypeFilter = !!selectedRobotTypeLabel;

  // "타입만 선택"인 경우
  const isTypeOnlyFilter = hasTypeFilter && !hasRobotNameFilter;

  let backgroundImage: string;

  if (hasRobotNameFilter) {
    // 1) 로봇 이름 필터가 걸린 경우 (이름만 선택이든, 타입+이름이든)
    //    → 기본 배경색으로 꽉 채움
    backgroundImage = `conic-gradient(${DEFAULT_BACKGROUND_COLOR} 0deg 360deg)`;

  } else if (isTypeOnlyFilter && selectedRobotTypeLabel) {
    // 2) 타입만 선택된 경우
    //    → 선택된 타입 색으로 꽉 채움
    const color = robotTypeColorMap[selectedRobotTypeLabel] ?? DEFAULT_BACKGROUND_COLOR;
    backgroundImage = `conic-gradient(${color} 0deg 360deg)`;

  } else if (singleType) {
    // 3) 필터는 없는데, 우연히 데이터가 한 타입만 있는 경우
    const color = robotTypeColorMap[singleType] ?? DEFAULT_BACKGROUND_COLOR;
    backgroundImage = `conic-gradient(${color} 0deg 360deg)`;

  } else {
    // 4) Total Robots (필터 X, 여러 타입 존재)
    backgroundImage = buildConicGradient(data);
  }

  return (
    <div className={styles.totalDonut}>

        <div className={styles.totalDonutBorder}>
            {/* 바깥 컬러 도넛 */}
            <div
                className={styles.totalDonutOuter}
                style={{ backgroundImage }}
            >
                <div className={styles.totalDonutGap}>
                    {/* 안쪽 어두운 링 + 중앙 원 */}
                    <div className={styles.totalDonutInner}>
                      <div className={styles.totalDonutCenter}>
                        {/* 🔽 라벨/아이콘 부분은 이전에 만든 조건 그대로 두고 */}
                        {selectedRobotName ? (
                          <>
                            <div className={styles.centerLabelTop}>{selectedRobotName}</div>
                            <div className={styles.centerRobotIcon}>
                              <img
                                src={`/icon/robot_icon(${iconNumber}).png`}
                                alt={selectedRobotName}
                              />
                            </div>
                          </>
                        ) : selectedRobotTypeLabel ? (
                          <>
                            <div className={styles.centerLabelTop}>{robotTypeKorMap[selectedRobotTypeLabel] ?? selectedRobotTypeLabel}</div>
                          </>
                        ) : (
                          <>
                            <div className={styles.centerLabelTop}>전체</div>
                          </>
                        )}

                        {/* 공통: 숫자 + 단위 → 로봇 이름 선택된 경우엔 감춤 */}
                        {!selectedRobotName && (
                          <>
                            <div className={styles.centerNumber}>{FilterTotalUnits ?? 0}</div>
                            <div className={styles.centerUnit}>units</div>
                          </>
                        )}
                      </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
}
