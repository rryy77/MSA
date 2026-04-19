import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getMsaConfig, tryGetMsaConfig } from "@/lib/msaConfig";
import {
  decodeMsaSessionCookie,
  encodeMsaSessionCookie,
  MSA_SESSION_COOKIE_NAME,
} from "@/lib/msaSession";

export async function GET() {
  const cfg = tryGetMsaConfig();
  if (!cfg) {
    return NextResponse.json({ configured: false, actor: null, role: null });
  }
  const raw = (await cookies()).get(MSA_SESSION_COOKIE_NAME)?.value;
  const session = decodeMsaSessionCookie(raw);
  if (!session) {
    return NextResponse.json({ configured: true, actor: null, role: null });
  }
  return NextResponse.json({
    configured: true,
    actor: session.actor,
    role: session.role,
  });
}

export async function POST(req: Request) {
  try {
    getMsaConfig();
  } catch (e) {
    return NextResponse.json(
      { error: "msa_not_configured", message: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }

  let body: { actor?: string };
  try {
    body = (await req.json()) as { actor?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const a = body.actor?.toLowerCase();
  if (a !== "a" && a !== "b") {
    return NextResponse.json({ error: "invalid_actor" }, { status: 400 });
  }

  const value = encodeMsaSessionCookie(a);
  const res = NextResponse.json({ ok: true, actor: a, role: a === "a" ? "organizer" : "participant" });
  res.cookies.set(MSA_SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(MSA_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
