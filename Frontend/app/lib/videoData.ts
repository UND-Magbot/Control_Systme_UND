import type { VideoItem } from "@/app/type";
import { videoRows } from "@/app/mock/video_data";

// const API_BASE = process.env.API_BASE; // 서버 컴포넌트용 환경변수

// 서버에서 카메라 목록 가져오고 → 가공해서 반환
export default async function getVideoInfo(): Promise<VideoItem[]> {

//   const res = await fetch(`${API_BASE}/robots`, {
//     cache: "no-store", // 항상 최신 데이터가 필요하면
//   });

//   if (!res.ok) {
//     throw new Error("Failed to fetch robots");
//   }

//   const raw = await res.json();
  const raw = videoRows;
  

  const videoRow = raw.map((item: any) => ({
    id: item.id,
    robotNo: item.robotNo,
    cameraNo: item.cameraNo,
    cameraType: item.cameraType,
    filename: item.filename,
    contentType: item.contentType,
    data: item.data,
    videoTime: item.videoTime,
    date: item.date,
  }));

  return videoRow;
}