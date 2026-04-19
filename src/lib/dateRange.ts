import { DateTime } from "luxon";
import { TIMEZONE } from "./constants";

/**
 * トリガー日 D（JST）から候補に載せる暦日（YYYY-MM-DD）。
 * D を含む 9 日間: D 〜 D+8（例: 4/4 なら 4/4〜4/12）。
 * @deprecated 主催者 UI は getSelectableDatesJstYear を使用
 */
export function getSelectableDatesJst(trigger: Date): string[] {
  const d = DateTime.fromJSDate(trigger).setZone(TIMEZONE).startOf("day");
  const dates: string[] = [];
  for (let i = 0; i <= 8; i++) {
    dates.push(d.plus({ days: i }).toISODate()!);
  }
  return dates;
}

/**
 * トリガー日を含む JST 暦日を最大 365 日分（1 年ぶん）。
 */
export function getSelectableDatesJstYear(trigger: Date): string[] {
  const d = DateTime.fromJSDate(trigger).setZone(TIMEZONE).startOf("day");
  const dates: string[] = [];
  for (let i = 0; i < 365; i++) {
    dates.push(d.plus({ days: i }).toISODate()!);
  }
  return dates;
}
