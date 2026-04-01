import type { Floor } from "@/app/type";

export default function getFloor(): Floor[] {
  return [
    { id: 1, label: "B2" },
    { id: 2, label: "B1" },
    { id: 3, label: "1F" },
    { id: 4, label: "2F" },
    { id: 5, label: "3F" },
  ];
}
