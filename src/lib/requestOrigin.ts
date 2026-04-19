/**
 * リバースプロキシ経由でも、ブラウザが見ている公開オリジンに近い値を返す。
 */
export function getOriginFromRequest(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

  if (forwardedHost) {
    const proto = forwardedProto || "https";
    return `${proto}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.split(",")[0]?.trim() || url.host;
  const proto =
    forwardedProto || (url.protocol === "https:" ? "https" : "http");
  return `${proto}://${host}`;
}
