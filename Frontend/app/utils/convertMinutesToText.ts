export function convertMinutesToText(min: number) {
  if (!Number.isFinite(min) || min < 0) return "0h 0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}