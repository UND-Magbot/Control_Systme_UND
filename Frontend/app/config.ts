export const API_BASE =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? `http://${window.location.hostname}:8000`
    : "http://localhost:8000";
