import { DateTime } from "luxon";
import { NextResponse } from "next/server";
import { TIMEZONE } from "@/lib/constants";
import { getMsaAuth } from "@/lib/msaApiAuth";
import { listSessions } from "@/lib/store";

type MonthStat = {
  month: string;
  count: number;
  hours: number;
};

export async function GET() {
  const auth = await getMsaAuth();
  if ("error" in auth) return auth.error;

  const sessions = await listSessions();
  const byMonth = new Map<string, { count: number; minutes: number }>();

  for (const s of sessions) {
    const isOrganizer = auth.ok.msa.role === "organizer" && s.organizerUserId === auth.ok.msa.uid;
    const isParticipant = auth.ok.msa.role === "participant" && s.participantUserId === auth.ok.msa.uid;
    if (!isOrganizer && !isParticipant) continue;
    if (s.status !== "completed" || s.calendarCreated !== true) continue;
    const finals = (s.organizerFinalIds ?? [])
      .map((id) => s.slots.find((x) => x.id === id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
    for (const slot of finals) {
      const st = DateTime.fromISO(slot.start, { zone: TIMEZONE });
      const en = DateTime.fromISO(slot.end, { zone: TIMEZONE });
      if (!st.isValid || !en.isValid || en <= st) continue;
      const key = st.toFormat("yyyy-MM");
      const prev = byMonth.get(key) ?? { count: 0, minutes: 0 };
      byMonth.set(key, {
        count: prev.count + 1,
        minutes: prev.minutes + Math.round(en.diff(st, "minutes").minutes),
      });
    }
  }

  const months: MonthStat[] = Array.from(byMonth.entries())
    .map(([month, v]) => ({
      month,
      count: v.count,
      hours: Math.round((v.minutes / 60) * 10) / 10,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));

  const currentKey = DateTime.now().setZone(TIMEZONE).toFormat("yyyy-MM");
  const current = months.find((m) => m.month === currentKey) ?? { month: currentKey, count: 0, hours: 0 };

  return NextResponse.json({ current, months });
}

