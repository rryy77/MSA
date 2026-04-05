/**
 * 参加用リンク・プッシュ通知の URL 用。
 * Vercel 上で AUTH_URL / NEXT_PUBLIC_APP_URL が localhost のままだと通知が localhost を指すため、
 * VERCEL_URL（本番デプロイのホスト）へフォールバックする。
 */
function isLocalhostHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function isLocalhostBase(url: string): boolean {
  const s = url.trim();
  if (!s) return false;
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    return isLocalhostHost(u.hostname);
  } catch {
    return /localhost|127\.0\.0\.1/i.test(s);
  }
}

export function getAppBaseUrl(): string {
  const vercelHost = process.env.VERCEL_URL?.trim();
  const vercelHttps = vercelHost ? `https://${vercelHost}` : "";
  const onVercel = process.env.VERCEL === "1";

  const auth = process.env.AUTH_URL?.trim().replace(/\/$/, "");
  const pub = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");

  function resolve(candidate: string | undefined): string | null {
    if (!candidate) return null;
    if (onVercel && vercelHttps && isLocalhostBase(candidate)) {
      return vercelHttps;
    }
    return candidate;
  }

  const ra = resolve(auth);
  if (ra) return ra;
  const rp = resolve(pub);
  if (rp) return rp;
  if (vercelHttps) return vercelHttps;
  if (auth) return auth;
  if (pub) return pub;
  return "http://localhost:3000";
}
