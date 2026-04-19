import { NextResponse } from "next/server";
import { requireMsaOrganizer } from "@/lib/msaApiAuth";

/** 参加者ピッカー廃止のため空一覧（後方互換で API は残す） */
export async function GET() {
  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;
  return NextResponse.json({ profiles: [] });
}
