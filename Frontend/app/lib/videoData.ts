import type { VideoItem } from "@/app/type";
import { videoRows } from "@/app/mock/video_data";

export default function getVideoInfo(): VideoItem[] {
  return videoRows.map((item: any) => ({
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
}
