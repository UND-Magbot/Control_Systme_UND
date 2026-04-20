import type { PowerItem } from "@/app/types";

export default function getPowerStatus(): PowerItem[] {
  return [
    { id: 1, label: "On" },
    { id: 2, label: "Off" },
  ];
}
