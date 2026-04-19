import { createHmac, timingSafeEqual } from "crypto";
import { getMsaConfig, msaSessionSecret } from "@/lib/msaConfig";

const COOKIE_NAME = "msa_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

export type MsaActor = "a" | "b";

export type MsaSessionPayload = {
  uid: string;
  actor: MsaActor;
  role: "organizer" | "participant";
};

function signPayload(payloadB64: string): string {
  return createHmac("sha256", msaSessionSecret()).update(payloadB64).digest("base64url");
}

/** Cookie 値を生成（Route Handler の Set-Cookie 用） */
export function encodeMsaSessionCookie(actor: MsaActor): string {
  const cfg = getMsaConfig();
  const uid = actor === "a" ? cfg.organizerId : cfg.participantId;
  const role = actor === "a" ? "organizer" : "participant";
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const inner = JSON.stringify({ uid, actor, role, exp });
  const payloadB64 = Buffer.from(inner, "utf-8").toString("base64url");
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

export function decodeMsaSessionCookie(
  value: string | undefined | null,
): MsaSessionPayload | null {
  if (!value?.trim()) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  try {
    const expected = signPayload(payloadB64);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const inner = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as {
      uid?: string;
      actor?: string;
      role?: string;
      exp?: number;
    };
    if (typeof inner.exp !== "number" || inner.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (inner.actor !== "a" && inner.actor !== "b") return null;
    if (inner.role !== "organizer" && inner.role !== "participant") return null;
    if (typeof inner.uid !== "string" || !inner.uid) return null;
    return {
      uid: inner.uid,
      actor: inner.actor,
      role: inner.role,
    };
  } catch {
    return null;
  }
}

export function getMsaSessionFromCookies(cookieStore: {
  get: (n: string) => { value: string } | undefined;
}): MsaSessionPayload | null {
  return decodeMsaSessionCookie(cookieStore.get(COOKIE_NAME)?.value);
}

export { COOKIE_NAME as MSA_SESSION_COOKIE_NAME };
