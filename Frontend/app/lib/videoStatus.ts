import type { Video } from "@/app/type";

export default function getVideoStatus(): Video[] {
  return [
    { id: 1, label: "AR" },
    { id: 2, label: "MR" },
  ];
}
