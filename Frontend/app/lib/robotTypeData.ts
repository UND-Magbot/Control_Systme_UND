import type { RobotType } from "@/app/type";

export default function getRobotType(): RobotType[] {
  return [
    { id: 1, label: "QUADRUPED" },
    { id: 2, label: "COBOT" },
    { id: 3, label: "AMR" },
    { id: 4, label: "HUMANOID" },
  ];
}
