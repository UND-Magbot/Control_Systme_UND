/**
 * 경로 순서 문자열에 각 경유지 대기 시간을 부착한 표시용 문자열을 생성한다.
 *
 * 예: pathOrder = "A - B - C", waitSeconds = [0, 3, 0]
 *     → "A - B(3s) - C"  (separator 기본 " - ")
 *     → "A → B(3s) → C"  (separator " → ")
 *
 * 대기 시간이 없거나 0이면 표기를 생략한다.
 */
export function formatPathOrderWithWaits(
  pathOrder: string | null | undefined,
  waitSeconds: number[] | null | undefined,
  separator: string = " - ",
): string {
  const order = (pathOrder ?? "").trim();
  if (!order) return "";
  const places = order.split(" - ");
  const decorated = places.map((p, i) => {
    const w = waitSeconds?.[i];
    return typeof w === "number" && w > 0 ? `${p}(${w}s)` : p;
  });
  return decorated.join(separator);
}
