import { useEffect, useRef, useState } from "react";
import type { RobotRowData, RobotType } from "@/app/types";
import { getStatistics } from "@/app/lib/statisticsApi";
import type { StatisticsResponse } from "@/app/lib/statisticsApi";
import { calcPrevPeriod } from "../utils/videoHelpers";

type Params = {
  enabled: boolean;
  selectedRobotType: RobotType | null;
  selectedRobot: RobotRowData | null;
  startDate: string | null;
  endDate: string | null;
  onLoaded?: () => void;
};

type Result = {
  statsData: StatisticsResponse | null;
  prevStatsData: StatisticsResponse | null;
};

/** 통계 탭 데이터 조회 (현재 + 이전 기간 병렬, 400ms 디바운스, race 방지).
 *  enabled=false일 때는 즉시 onLoaded만 호출 (페이지 ready 마커용). */
export function useStatsFetch({
  enabled,
  selectedRobotType,
  selectedRobot,
  startDate,
  endDate,
  onLoaded,
}: Params): Result {
  const [statsData, setStatsData] = useState<StatisticsResponse | null>(null);
  const [prevStatsData, setPrevStatsData] = useState<StatisticsResponse | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      onLoaded?.();
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const id = ++fetchIdRef.current;
      const baseParams = {
        robot_type: selectedRobotType?.label,
        robot_name: selectedRobot?.no,
      };

      const currentFetch = getStatistics({
        ...baseParams,
        start_date: startDate ?? undefined,
        end_date: endDate ?? undefined,
      });

      const prev = calcPrevPeriod(startDate, endDate);
      const prevFetch = prev
        ? getStatistics({ ...baseParams, start_date: prev.prevStart, end_date: prev.prevEnd })
        : Promise.resolve(null);

      Promise.all([currentFetch, prevFetch]).then(([result, prevResult]) => {
        if (id === fetchIdRef.current) {
          setStatsData(result.data);
          setPrevStatsData(prevResult?.data ?? null);
          if (result.error) console.error("[통계] API 오류:", result.error);
          onLoaded?.();
        }
      });
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedRobotType, selectedRobot, startDate, endDate]);

  return { statsData, prevStatsData };
}
