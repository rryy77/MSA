import fs from "fs/promises";
import path from "path";

import type { Session } from "./types";
import { createServiceRoleClient } from "./supabase/service";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "sessions.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

let warnedMissingServiceRole: boolean;

/** service_role があれば Supabase（本番・Vercel 用）。無ければローカル JSON（開発用）。 */
function db() {
  const c = createServiceRoleClient();
  if (
    !c &&
    !warnedMissingServiceRole &&
    process.env.VERCEL === "1"
  ) {
    warnedMissingServiceRole = true;
    console.warn(
      "[MSA] Vercel 上で SUPABASE_SERVICE_ROLE_KEY が未設定です。日程は保存されません。005_msa_sessions.sql を実行し、Vercel の Environment Variables に service_role キーを設定してください。",
    );
  }
  return c;
}

async function loadSessionsFile(): Promise<Record<string, Session>> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw) as Record<string, Session>;
  } catch {
    return {};
  }
}

async function saveSessionsFile(data: Record<string, Session>) {
  await ensureDir();
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function getSession(id: string): Promise<Session | undefined> {
  const service = db();
  if (service) {
    const { data, error } = await service
      .from("msa_sessions")
      .select("body")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("msa_sessions getSession", error);
      return undefined;
    }
    if (!data?.body) return undefined;
    return data.body as Session;
  }
  const all = await loadSessionsFile();
  return all[id];
}

function sessionForJsonb(session: Session): Record<string, unknown> {
  return JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
}

export async function putSession(session: Session): Promise<void> {
  const service = db();
  if (service) {
    const payload = {
      organizer_user_id: session.organizerUserId ?? null,
      participant_token: session.participantToken,
      body: sessionForJsonb(session),
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: selErr } = await service
      .from("msa_sessions")
      .select("id")
      .eq("id", session.id)
      .maybeSingle();

    if (selErr) {
      console.error("msa_sessions putSession(select)", selErr);
      throw new Error(`msa_sessions: ${selErr.message}${selErr.code ? ` (${selErr.code})` : ""}`);
    }

    if (existing) {
      const { error } = await service.from("msa_sessions").update(payload).eq("id", session.id);
      if (error) {
        console.error("msa_sessions putSession(update)", error);
        throw new Error(`msa_sessions update: ${error.message}${error.code ? ` (${error.code})` : ""}`);
      }
    } else {
      const { error } = await service.from("msa_sessions").insert({
        id: session.id,
        ...payload,
      });
      if (error) {
        console.error("msa_sessions putSession(insert)", error);
        if (error.code === "23505") {
          const { error: retryErr } = await service.from("msa_sessions").update(payload).eq("id", session.id);
          if (retryErr) {
            throw new Error(`msa_sessions update-after-dup: ${retryErr.message}`);
          }
        } else {
          throw new Error(`msa_sessions insert: ${error.message}${error.code ? ` (${error.code})` : ""}`);
        }
      }
    }
    return;
  }
  if (process.env.VERCEL === "1") {
    throw new Error(
      "MSA_SESSION_STORAGE: SUPABASE_SERVICE_ROLE_KEY が未設定のため Vercel 上で日程を保存できません。",
    );
  }
  const all = await loadSessionsFile();
  all[session.id] = session;
  await saveSessionsFile(all);
}

function sortKeyTriggerAt(s: Session): string {
  return typeof s.triggerAt === "string" ? s.triggerAt : "";
}

export async function listSessionSummaries(organizerUserId?: string) {
  const service = db();
  if (service) {
    let q = service.from("msa_sessions").select("body");
    if (organizerUserId) {
      q = q.eq("organizer_user_id", organizerUserId);
    }
    const { data, error } = await q;
    if (error) {
      console.error("msa_sessions listSessionSummaries", error);
      return [];
    }
    const rows = (data ?? [])
      .map((r) => r.body as Session | null)
      .filter((s): s is Session => Boolean(s && typeof s.id === "string"));
    return rows
      .sort((a, b) => sortKeyTriggerAt(b).localeCompare(sortKeyTriggerAt(a)))
      .map((s) => ({
        id: s.id,
        status: s.status,
        triggerDateJst: s.triggerDateJst,
        triggerAt: s.triggerAt,
      }));
  }
  const all = await loadSessionsFile();
  let rows = Object.values(all);
  if (organizerUserId) {
    rows = rows.filter((s) => s.organizerUserId === organizerUserId);
  }
  return rows
    .filter((s) => typeof s.id === "string")
    .sort((a, b) => sortKeyTriggerAt(b).localeCompare(sortKeyTriggerAt(a)))
    .map((s) => ({
      id: s.id,
      status: s.status,
      triggerDateJst: s.triggerDateJst,
      triggerAt: s.triggerAt,
    }));
}

export async function listSessions(organizerUserId?: string): Promise<Session[]> {
  const service = db();
  if (service) {
    let q = service.from("msa_sessions").select("body");
    if (organizerUserId) q = q.eq("organizer_user_id", organizerUserId);
    const { data, error } = await q;
    if (error) {
      console.error("msa_sessions listSessions", error);
      return [];
    }
    const rows = (data ?? [])
      .map((r) => r.body as Session | null)
      .filter((s): s is Session => Boolean(s && typeof s.id === "string"));
    return rows.sort((a, b) => sortKeyTriggerAt(b).localeCompare(sortKeyTriggerAt(a)));
  }
  const all = await loadSessionsFile();
  let rows = Object.values(all);
  if (organizerUserId) rows = rows.filter((s) => s.organizerUserId === organizerUserId);
  return rows
    .filter((s) => typeof s.id === "string")
    .sort((a, b) => sortKeyTriggerAt(b).localeCompare(sortKeyTriggerAt(a)));
}

export async function findSessionByParticipantToken(token: string): Promise<Session | undefined> {
  const service = db();
  if (service) {
    const { data, error } = await service
      .from("msa_sessions")
      .select("body")
      .eq("participant_token", token)
      .maybeSingle();
    if (error) {
      console.error("msa_sessions findSessionByParticipantToken", error);
      return undefined;
    }
    if (!data?.body) return undefined;
    return data.body as Session;
  }
  const all = await loadSessionsFile();
  return Object.values(all).find((s) => s.participantToken === token);
}

/** 開発用: ファイルストアにだけ存在する場合の移行に使える（未使用でも可） */
export async function loadSessions(): Promise<Record<string, Session>> {
  return loadSessionsFile();
}

export async function saveSessions(data: Record<string, Session>): Promise<void> {
  await saveSessionsFile(data);
}
