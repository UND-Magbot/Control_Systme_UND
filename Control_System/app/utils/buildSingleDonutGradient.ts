export function buildSingleDonutGradient(
  percent: number,
  color: string,
  background = "#5d6174"
) {
  const clamped = Math.max(0, Math.min(100, percent));
  const deg = (clamped / 100) * 360;

  return `
    conic-gradient(
      ${color} 0deg ${deg}deg,
      ${background} ${deg}deg 360deg
    )
  `;
}