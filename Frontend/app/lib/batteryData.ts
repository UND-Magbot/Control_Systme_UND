import type { BatteryItem } from "@/app/type";

export default function getBatteryStatus(): BatteryItem[] {
  return [
    { id: 1, label: "76% ~ 100%", min: 76, max: 100 },
    { id: 2, label: "51% ~ 75%",  min: 51, max: 75 },
    { id: 3, label: "26% ~ 50%",  min: 26, max: 50 },
    { id: 4, label: "1% ~ 25%",   min: 1,  max: 25 },
    { id: 5, label: "0%",         min: 0,  max: 0  },
    { id: 6, label: "Charging",   charging: true },
  ];
}
