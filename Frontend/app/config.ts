export const API_BASE =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `http://${window.location.hostname}:8001`
    : "http://localhost:8001";
