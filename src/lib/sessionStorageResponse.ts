import { NextResponse } from "next/server";

import type { Session } from "./types";

import { putSession } from "./store";

/**
 * putSession が失敗したときに JSON を返し、Vercel ログに詳細を残す。
 */
export async function persistSessionOrError(session: Session): Promise<NextResponse | null> {
  try {
    await putSession(session);
    return null;
  } catch (e) {
    console.error("persistSession", e);
    const raw = e instanceof Error ? e.message : String(e);
    let message =
      "日程の保存に失敗しました。しばらくしてから再度お試しください。";
    if (/relation|does not exist|msa_sessions|PGRST205|42P01/i.test(raw)) {
      message =
        "データベースに日程用テーブルがありません。Supabase の SQL Editor で supabase/migrations/005_msa_sessions.sql を実行してください。";
    } else if (
      /SERVICE_ROLE|service_role|MSA_SESSION_STORAGE|未設定/i.test(raw)
    ) {
      message =
        "サーバーに SUPABASE_SERVICE_ROLE_KEY が設定されていません。Vercel の Environment Variables に追加し、再デプロイしてください。";
    } else if (/permission denied|42501|insufficient_privilege/i.test(raw)) {
      message =
        "データベースへの書き込み権限がありません。006_msa_sessions_grants.sql を実行するか、管理者に確認してください。";
    } else if (/23503|foreign key/i.test(raw)) {
      message =
        "保存データの整合性エラーです。一度ログアウトしてログインし直し、新しい日程調整からやり直してください。";
    }
    return NextResponse.json(
      { error: "session_save_failed", message },
      { status: 500 },
    );
  }
}
