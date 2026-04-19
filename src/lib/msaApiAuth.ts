import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getMsaConfig, tryGetMsaConfig, type MsaConfig } from "@/lib/msaConfig";
import { getMsaSessionFromCookies, type MsaSessionPayload } from "@/lib/msaSession";

export type MsaAuthOk = { cfg: MsaConfig; msa: MsaSessionPayload };

export async function getMsaAuth(): Promise<
  | { ok: MsaAuthOk }
  | { error: NextResponse }
> {
  const cfg = tryGetMsaConfig();
  if (!cfg) {
    return {
      error: NextResponse.json({ error: "msa_not_configured" }, { status: 503 }),
    };
  }
  const msa = getMsaSessionFromCookies(await cookies());
  if (!msa) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  return { ok: { cfg, msa } };
}

/** 主催者（A）としてログイン済みか */
export async function requireMsaOrganizer(): Promise<
  | { ok: MsaAuthOk }
  | { error: NextResponse }
> {
  const r = await getMsaAuth();
  if ("error" in r) return r;
  const {
    ok: { cfg, msa },
  } = r;
  if (msa.role !== "organizer" || msa.uid !== cfg.organizerId) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return r;
}

/** 環境変数だけ確認（ログイン API 用） */
export function getMsaConfigOrThrow(): MsaConfig {
  return getMsaConfig();
}
