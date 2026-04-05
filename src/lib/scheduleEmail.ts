import { DateTime } from "luxon";
import type { Slot } from "./slots";
import { TIMEZONE } from "./constants";

/** Luxon weekday 1=月 … 7=日 */
const WD_JP = ["月", "火", "水", "木", "金", "土", "日"];

function formatSlotLine(slot: Slot): string {
  const start = DateTime.fromISO(slot.start, { zone: TIMEZONE });
  const end = DateTime.fromISO(slot.end, { zone: TIMEZONE });
  if (!start.isValid || !end.isValid) return slot.label;
  const w = WD_JP[start.weekday - 1] ?? "";
  return `${start.month}月${start.day}日(${w}) ${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`;
}

/** プレーンテキスト本文ブロック（日程の列挙） */
export function buildSchedulePlainText(
  slots: Slot[],
  intro = "確定した日程は次のとおりです。",
): string {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const lines = sorted.map((s) => `・${formatSlotLine(s)}`);
  return [intro, "", ...lines].join("\n");
}

/** HTML 用：日程リスト */
export function buildScheduleHtmlList(
  slots: Slot[],
  intro = "確定した日程は次のとおりです。",
): string {
  const sorted = [...slots].sort((a, b) => a.start.localeCompare(b.start));
  const items = sorted
    .map((s) => {
      const line = formatSlotLine(s);
      return `<li style="margin:6px 0">${line.replace(/</g, "&lt;")}</li>`;
    })
    .join("");
  return `<p style="margin:12px 0 8px;font-weight:600">${intro.replace(/</g, "&lt;")}</p><ul style="margin:0;padding-left:1.2em">${items}</ul>`;
}
