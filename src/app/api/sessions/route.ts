import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getMsaConfig } from "@/lib/msaConfig";
import { getMsaSessionFromCookies } from "@/lib/msaSession";
import { createSession } from "@/lib/sessionFactory";
import { persistSessionOrError } from "@/lib/sessionStorageResponse";
import { listSessionSummaries } from "@/lib/store";

export async function GET() {
  try {
    const cfg = getMsaConfig();
    const msa = getMsaSessionFromCookies(await cookies());
    if (!msa || msa.role !== "organizer" || msa.uid !== cfg.organizerId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const list = await listSessionSummaries(cfg.organizerId);
    return NextResponse.json({ sessions: list });
  } catch (e) {
    console.error("GET /api/sessions", e);
    return NextResponse.json(
      {
        error: "sessions_list_failed",
        message:
          e instanceof Error ? e.message : "日程一覧の取得に失敗しました。ページを再読み込みしてください。",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const cfg = getMsaConfig();
    const msa = getMsaSessionFromCookies(await cookies());
    if (!msa || msa.role !== "organizer" || msa.uid !== cfg.organizerId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const session = createSession(new Date());
    session.organizerUserId = cfg.organizerId;
    const persistErr = await persistSessionOrError(session);
    if (persistErr) return persistErr;
    return NextResponse.json({ session });
  } catch (e) {
    console.error("POST /api/sessions", e);
    return NextResponse.json(
      {
        error: "session_create_failed",
        message:
          e instanceof Error ? e.message : "日程の作成に失敗しました。ページを再読み込みしてください。",
      },
      { status: 500 },
    );
  }
}
