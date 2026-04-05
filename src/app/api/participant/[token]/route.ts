import { NextResponse } from "next/server";
import { findSessionByParticipantToken } from "@/lib/store";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const session = await findSessionByParticipantToken(decodeURIComponent(token));
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ session });
}
