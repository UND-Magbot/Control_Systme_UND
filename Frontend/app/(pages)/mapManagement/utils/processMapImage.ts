/**
 * 맵 이미지에서 "바깥쪽 미탐색(회색) 영역"만 투명으로 지우고 DataURL을 반환.
 *
 * 로직:
 * 1) 이미지를 Canvas에 그리고
 * 2) 가장자리에서 시작하는 BFS flood-fill로 바깥 회색 픽셀만 알파 0으로 설정
 *    — 맵 내부 벽(진회색) 과 공간(흰색)은 건드리지 않음
 * 3) Canvas를 DataURL로 변환
 *
 * `isGrayPixel`: r/g/b 편차가 20 미만 + r이 100~253 사이 (완전 흰색/검정 제외).
 */
export function processMapImage(
  img: HTMLImageElement
): { url: string; w: number; h: number } {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const w = canvas.width;
  const h = canvas.height;

  const isGrayPixel = (idx: number) => {
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    return Math.abs(r - g) < 20 && Math.abs(r - b) < 20 && r > 100 && r < 253;
  };

  const visited = new Uint8Array(w * h);
  const queue: number[] = [];

  // 4변 가장자리 회색 픽셀을 flood-fill 시드로
  for (let x = 0; x < w; x++) {
    if (isGrayPixel(x * 4)) queue.push(x);
    const bottom = (h - 1) * w + x;
    if (isGrayPixel(bottom * 4)) queue.push(bottom);
  }
  for (let y = 0; y < h; y++) {
    if (isGrayPixel(y * w * 4)) queue.push(y * w);
    const right = y * w + (w - 1);
    if (isGrayPixel(right * 4)) queue.push(right);
  }

  // BFS — 바깥 회색만 투명 처리
  while (queue.length > 0) {
    const pos = queue.pop()!;
    if (visited[pos]) continue;
    visited[pos] = 1;

    const idx = pos * 4;
    if (!isGrayPixel(idx)) continue;

    data[idx + 3] = 0; // 투명

    const x = pos % w, y = Math.floor(pos / w);
    if (x > 0) queue.push(pos - 1);
    if (x < w - 1) queue.push(pos + 1);
    if (y > 0) queue.push(pos - w);
    if (y < h - 1) queue.push(pos + w);
  }

  ctx.putImageData(imageData, 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    w: img.width,
    h: img.height,
  };
}
