import { DateTime } from "luxon";
import type { Slot } from "./slots";
import { TIMEZONE } from "./constants";

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** UTC の ICS 日時 YYYYMMDDTHHmmssZ */
function toIcsUtc(iso: string): string {
  const d = DateTime.fromISO(iso, { zone: TIMEZONE });
  if (!d.isValid) return "";
  return d.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
}

/**
 * 複数スロットを 1 つの iCalendar ファイルにまとめる（PUBLISH）。
 */
export function buildIcsCalendar(
  slots: Slot[],
  sessionId: string,
  title = "MSA 日程",
): string {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const now = DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MSA//Schedule//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const slot of sorted) {
    const dtStart = toIcsUtc(slot.start);
    const dtEnd = toIcsUtc(slot.end);
    if (!dtStart || !dtEnd) continue;
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
    const uid = `${safe(sessionId)}-${safe(slot.id)}@msa.local`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(slot.label)}`,
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
