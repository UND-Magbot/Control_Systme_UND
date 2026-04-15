import { useEffect, useRef, useState } from "react";
import type { RobotRowData, Video, VideoItem } from "@/app/types";
import getVideoInfo from "@/app/lib/videoData";

type Params = {
  enabled: boolean;
  robots: RobotRowData[];
  selectedRobot: RobotRowData | null;
  selectedVideo: Video | null;
  startDate: string;
  endDate: string;
  onLoaded?: () => void;
};

/** 영상 탭 서버 사이드 필터링 (400ms 디바운스, race 방지). */
export function useVideoFetch({
  enabled,
  robots,
  selectedRobot,
  selectedVideo,
  startDate,
  endDate,
  onLoaded,
}: Params): [VideoItem[], React.Dispatch<React.SetStateAction<VideoItem[]>>] {
  const [videoData, setVideoData] = useState<VideoItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const id = ++fetchIdRef.current;
      const robot = selectedRobot ? robots.find((r) => r.no === selectedRobot.no) : null;

      getVideoInfo({
        robot_id: robot?.id ?? undefined,
        record_type: selectedVideo?.label ?? undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        size: 100,
      }).then((res) => {
        if (id === fetchIdRef.current) {
          setVideoData(res.items);
          onLoaded?.();
        }
      });
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedVideo, selectedRobot, startDate, endDate]);

  return [videoData, setVideoData];
}
