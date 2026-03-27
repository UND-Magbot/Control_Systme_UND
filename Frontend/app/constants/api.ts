export function getApiBase(): string {
  if (typeof window !== "undefined" && window.location.hostname !== "localhost") {
    return `http://${window.location.hostname}:8001`;
  }
  return "http://localhost:8001";
}
