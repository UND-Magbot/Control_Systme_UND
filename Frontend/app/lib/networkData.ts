import type { NetworkItem } from "@/app/type";

export default function getNetworkStatus(): NetworkItem[] {
  return [
    { id: 1, label: "Online" },
    { id: 2, label: "Offline" },
    { id: 3, label: "Error" },
  ];
}
