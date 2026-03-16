export function buildSingleDonutGradient(
  percent: number,
  color: string,
  background = "#5d6174"
) {
  const deg = (percent / 100) * 360;

  return `
    conic-gradient(
      ${color} 0deg ${deg}deg,
      ${background} ${deg}deg 360deg
    )
  `;
}