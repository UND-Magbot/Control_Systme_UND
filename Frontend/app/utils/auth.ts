/**
 * @deprecated useAuth() 훅을 사용하세요.
 * 기존 호환용으로 남겨둠 - 추후 제거 예정.
 */
export function isAdmin(): boolean {
  if (typeof document === "undefined") return false;

  const cookies = document.cookie.split(";").map((c) => c.trim());
  const permissionCookie = cookies.find((c) => c.startsWith("permission="));
  if (!permissionCookie) return false;

  const value = permissionCookie.split("=")[1];
  return value === "admin" || value === "1";
}
