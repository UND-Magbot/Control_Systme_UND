export function getApiBase(): string {
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return `http://${window.location.hostname}:8001`;
  }
  return "http://localhost:8001";
}

/** @deprecated getApiBase() 사용 권장 */
export const API_BASE = "http://localhost:8001";
