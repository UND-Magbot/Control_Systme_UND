import type { RobotType } from "@/app/types";

export default function getRobotType(): RobotType[] {
  return [
    { id: 1, label: "기본 4족" },
    { id: 2, label: "순찰 4족" },
    { id: 3, label: "보안 4족" },
  ];
}
