import fs from "fs/promises";
import path from "path";
import type { Session } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "sessions.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function loadSessions(): Promise<Record<string, Session>> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw) as Record<string, Session>;
  } catch {
    return {};
  }
}

export async function saveSessions(data: Record<string, Session>) {
  await ensureDir();
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf-8");
}

export async function getSession(id: string): Promise<Session | undefined> {
  const all = await loadSessions();
  return all[id];
}

export async function putSession(session: Session) {
  const all = await loadSessions();
  all[session.id] = session;
  await saveSessions(all);
}

export async function listSessionSummaries(organizerUserId?: string) {
  const all = await loadSessions();
  let rows = Object.values(all);
  if (organizerUserId) {
    rows = rows.filter((s) => s.organizerUserId === organizerUserId);
  }
  return rows
    .sort((a, b) => b.triggerAt.localeCompare(a.triggerAt))
    .map((s) => ({
      id: s.id,
      status: s.status,
      triggerDateJst: s.triggerDateJst,
      triggerAt: s.triggerAt,
    }));
}

export async function findSessionByParticipantToken(token: string): Promise<Session | undefined> {
  const all = await loadSessions();
  return Object.values(all).find((s) => s.participantToken === token);
}
