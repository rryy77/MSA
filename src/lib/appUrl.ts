/**
 * 参加用リンクなどの絶対 URL 用。本番では AUTH_URL または NEXT_PUBLIC_APP_URL を推奨。
 */
export function getAppBaseUrl(): string {
  const auth = process.env.AUTH_URL?.trim().replace(/\/$/, "");
  if (auth) return auth;
  const pub = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (pub) return pub;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
