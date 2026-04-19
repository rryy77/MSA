/**
 * LINE Login（OAuth 2.0 / OpenID）は LINEログインチャネルの Channel ID / secret が必須。
 * Messaging API チャネルの ID では、Console に Callback URL が無く invalid_redirect_uri になる。
 *
 * LINE_LOGIN_CHANNEL_* を優先し、未設定時のみ LINE_CHANNEL_*（後方互換）。
 */
export function getLineOAuthClientCredentials(): {
  clientId: string | undefined;
  clientSecret: string | undefined;
} {
  const loginId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  const loginSecret = process.env.LINE_LOGIN_CHANNEL_SECRET?.trim();
  if (loginId || loginSecret) {
    return { clientId: loginId, clientSecret: loginSecret };
  }
  return {
    clientId: process.env.LINE_CHANNEL_ID?.trim(),
    clientSecret: process.env.LINE_CHANNEL_SECRET?.trim(),
  };
}
