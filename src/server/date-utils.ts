/**
 * Date normalization utilities for AI extracted deadlines.
 */
export function normalizeDate(input: unknown, referenceDate: Date = new Date()): string | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
    return null;
  }

  // Check if it's already a valid ISO / parseable date
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  // Normalize common natural language expressions if the model didn't compute full ISO
  const lower = trimmed.toLowerCase();
  const ref = new Date(referenceDate);

  const tomorrowMatch = lower.match(/tomorrow(?:\s+at\s+|\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (tomorrowMatch) {
    const target = new Date(ref);
    target.setDate(target.getDate() + 1);
    let hours = parseInt(tomorrowMatch[1] ?? "9", 10);
    const minutes = parseInt(tomorrowMatch[2] ?? "0", 10);
    const meridiem = tomorrowMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    target.setHours(hours, minutes, 0, 0);
    return target.toISOString();
  }

  const todayMatch = lower.match(/today(?:\s+at\s+|\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (todayMatch) {
    const target = new Date(ref);
    let hours = parseInt(todayMatch[1] ?? "18", 10);
    const minutes = parseInt(todayMatch[2] ?? "0", 10);
    const meridiem = todayMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    target.setHours(hours, minutes, 0, 0);
    return target.toISOString();
  }

  return null;
}
