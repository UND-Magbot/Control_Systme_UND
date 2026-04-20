import type { Video } from "@/app/types";

export default function getVideoStatus(): Video[] {
  return [
    { id: 1, label: "자동" },
    { id: 2, label: "수동" },
  ];
}
