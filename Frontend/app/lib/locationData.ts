import type { LocationItem } from "@/app/type";

export default function getLocationStatus(): LocationItem[] {
  return [
    { id: 1, label: "Yes" },
    { id: 2, label: "No" },
  ];
}
