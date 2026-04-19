import { NextResponse } from "next/server";
import { buildDayRememberSuggestions, fetchDayRememberEntries } from "@/lib/dayRemember";
import { requireMsaOrganizer } from "@/lib/msaApiAuth";

export async function GET() {
  const auth = await requireMsaOrganizer();
  if ("error" in auth) return auth.error;

  const entries = await fetchDayRememberEntries(auth.ok.msa.uid);
  const suggestions = buildDayRememberSuggestions(entries);

  return NextResponse.json({ suggestions });
}
