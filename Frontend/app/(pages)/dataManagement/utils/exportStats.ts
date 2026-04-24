import type { StatisticsResponse } from "@/app/lib/statisticsApi";
import { convertMinutesToText } from "@/app/utils/convertMinutesToText";

/** 통계 데이터를 2시트 xlsx 파일로 내보낸다.
 *  Sheet 1: 요약 통계 (작업/로봇/에러/시간 2x2 블록)
 *  Sheet 2: 로봇별 현황
 */
export async function exportStatsToExcel(statsData: StatisticsResponse): Promise<void> {
  const XLSX = await import("xlsx");

  // Sheet 1: 요약 통계
  const totalTasks = statsData.tasks.completed + statsData.tasks.failed + statsData.tasks.cancelled;
  const totalTime = statsData.time_minutes.operating + statsData.time_minutes.charging + statsData.time_minutes.standby;
  const totalErrors = statsData.errors.network + statsData.errors.navigation + statsData.errors.battery + statsData.errors.etc;
  const totalRobots = statsData.robot_types.reduce((s, t) => s + t.count, 0);
  const taskSuccessRate = totalTasks > 0 ? Math.round((statsData.tasks.completed / totalTasks) * 100) : 0;
  const opRate = totalTime > 0 ? Math.round((statsData.time_minutes.operating / totalTime) * 100) : 0;

  const pct = (value: number, total: number) =>
    total > 0 ? `${Math.round((value / total) * 100)}%` : "0%";

  const taskBlock = [
    ["[작업 현황]"],
    ["항목", "값", "단위", "비율(%)"],
    ["완료", statsData.tasks.completed, "건", pct(statsData.tasks.completed, totalTasks)],
    ["실패", statsData.tasks.failed, "건", pct(statsData.tasks.failed, totalTasks)],
    ["취소", statsData.tasks.cancelled, "건", pct(statsData.tasks.cancelled, totalTasks)],
    ["합계", totalTasks, "건", "100%"],
    ["", "", "", ""],
    ["성공률", `${taskSuccessRate}%`, "", ""],
  ];
  const robotBlock = [
    ["[로봇 현황]"],
    ["항목", "값", "단위"],
    ...statsData.robot_types.map((t) => [t.type, t.count, "대"]),
    ["합계", totalRobots, "대"],
  ];
  const errorBlock = [
    ["[에러 현황]"],
    ["항목", "값", "단위", "비율(%)"],
    ["네트워크", statsData.errors.network, "건", pct(statsData.errors.network, totalErrors)],
    ["네비게이션", statsData.errors.navigation, "건", pct(statsData.errors.navigation, totalErrors)],
    ["배터리", statsData.errors.battery, "건", pct(statsData.errors.battery, totalErrors)],
    ["기타", statsData.errors.etc, "건", pct(statsData.errors.etc, totalErrors)],
    ["합계", totalErrors, "건", "100%"],
  ];
  const timeBlock = [
    ["[운행 시간]"],
    ["항목", "값(분)", "시간", "비율(%)"],
    ["운행", statsData.time_minutes.operating, convertMinutesToText(statsData.time_minutes.operating), `${opRate}%`],
    ["충전", statsData.time_minutes.charging, convertMinutesToText(statsData.time_minutes.charging), pct(statsData.time_minutes.charging, totalTime)],
    ["대기", statsData.time_minutes.standby, convertMinutesToText(statsData.time_minutes.standby), pct(statsData.time_minutes.standby, totalTime)],
    ["합계", totalTime, convertMinutesToText(totalTime), "100%"],
    ["", "", "", ""],
    ["가동률", `${opRate}%`, "", ""],
  ];

  // 2x2 레이아웃: 좌상=작업, 우상=로봇, 좌하=에러, 우하=시간
  const summaryWs = XLSX.utils.aoa_to_sheet(taskBlock, { origin: "A1" } as any);
  XLSX.utils.sheet_add_aoa(summaryWs, robotBlock, { origin: "F1" });
  XLSX.utils.sheet_add_aoa(summaryWs, errorBlock, { origin: "A12" });
  XLSX.utils.sheet_add_aoa(summaryWs, timeBlock, { origin: "F12" });

  // Sheet 2: 로봇별 현황
  const robotRows = statsData.per_robot.map((r) => {
    const rSuccessRate = r.tasks_total > 0 ? Math.round((r.tasks_completed / r.tasks_total) * 100) : 0;
    return {
      "로봇 명": r.robot_name,
      "로봇 타입": r.robot_type,
      "성공률(%)": `${rSuccessRate}%`,
      "완료 작업": r.tasks_completed,
      "총 작업": r.tasks_total,
      "에러": r.errors_total,
      "운행 시간(분)": r.operating_minutes,
      "운행 시간": convertMinutesToText(r.operating_minutes),
      "충전 시간(분)": r.charging_minutes,
      "충전 시간": convertMinutesToText(r.charging_minutes),
      "대기 시간(분)": r.standby_minutes,
      "대기 시간": convertMinutesToText(r.standby_minutes),
    };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summaryWs, "요약 통계");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(robotRows), "로봇별 현황");

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `statistics_export_${dateStr}.xlsx`);
}
