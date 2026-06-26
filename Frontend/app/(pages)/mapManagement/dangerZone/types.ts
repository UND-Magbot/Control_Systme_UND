// 위험구역(폴리곤) 도메인 타입
// 좌표는 모두 "월드 좌표(미터)"를 기준으로 저장한다.
// 화면 렌더링 시 geometry.worldToPixel / worldPolygonToSvgPoints 로 변환한다.

/** 월드 좌표 평면상의 한 점 (단위: 미터) */
export type ZonePoint = {
  x: number;
  y: number;
};

/** 위험구역 상태 */
export type DangerZoneStatus = "active" | "inactive";

/** 위험구역 (월드 좌표 폴리곤) */
export type DangerZone = {
  /** 로컬 임시 id 또는 서버 id */
  id: string;
  /** 위험구역 이름 */
  name: string;
  /** 소속 층 id (floor_info.id) */
  floorId: number | null;
  /** 폴리곤 꼭짓점 (월드 좌표, 최소 3개, 닫힘은 암묵적) */
  points: ZonePoint[];
  /** 활성/비활성 */
  status: DangerZoneStatus;
  /** 메모/설명 */
  description?: string | null;
  /** 서버 저장 여부 (false면 pending) */
  persisted?: boolean;
};

/** 월드 → 픽셀 변환에 필요한 맵 메타 */
export type MapMetaLike = {
  originX: number;
  originY: number;
  resolution: number;
  /** 처리된 맵 이미지 높이(px) */
  imgHeight: number;
};

/** 월드 → centered SVG 좌표 변환에 필요한 메타 (imgWidth 추가) */
export type SvgMetaLike = MapMetaLike & {
  /** 처리된 맵 이미지 너비(px) */
  imgWidth: number;
};
