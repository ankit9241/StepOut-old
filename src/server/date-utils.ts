/**
 * Date normalization and natural-language reminder offset utilities.
 */

export interface DateNormalizeOptions {
  referenceDate?: Date | undefined;
  timeZone?: string | undefined;
}

function getZonedParts(date: Date, timeZone?: string) {
  if (!timeZone) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
    };
  }
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    const parts = dtf.formatToParts(date);
    const p: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        p[part.type] = parseInt(part.value, 10);
      }
    }
    return {
      year: p["year"] ?? date.getFullYear(),
      month: p["month"] ?? date.getMonth() + 1,
      day: p["day"] ?? date.getDate(),
      hours: p["hour"] ?? date.getHours(),
      minutes: p["minute"] ?? date.getMinutes(),
    };
  } catch {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
    };
  }
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone?: string,
): Date {
  if (!timeZone) {
    const d = new Date();
    d.setFullYear(year, month - 1, day);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }
  try {
    const targetUtcMs = Date.UTC(year, month - 1, day, hours, minutes, 0, 0);
    let guess = targetUtcMs;
    for (let i = 0; i < 3; i++) {
      const zoned = getZonedParts(new Date(guess), timeZone);
      const zonedMs = Date.UTC(
        zoned.year,
        zoned.month - 1,
        zoned.day,
        zoned.hours,
        zoned.minutes,
        0,
        0,
      );
      const offset = zonedMs - guess;
      guess = targetUtcMs - offset;
    }
    return new Date(guess);
  } catch {
    const d = new Date();
    d.setFullYear(year, month - 1, day);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }
}

export function normalizeDate(
  input: unknown,
  referenceDateOrOptions: Date | DateNormalizeOptions = new Date(),
): string | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
    return null;
  }

  // Parse options
  const refDate =
    referenceDateOrOptions instanceof Date
      ? referenceDateOrOptions
      : referenceDateOrOptions.referenceDate || new Date();
  const timeZone =
    !(referenceDateOrOptions instanceof Date) && referenceDateOrOptions.timeZone
      ? referenceDateOrOptions.timeZone
      : undefined;

  // Check if it's already a valid ISO / parseable date
  const parsed = new Date(trimmed);
  if (
    !isNaN(parsed.getTime()) &&
    (trimmed.includes("T") || trimmed.includes("-") || trimmed.length > 10)
  ) {
    return parsed.toISOString();
  }

  // Normalize common natural language expressions
  const lower = trimmed.toLowerCase();
  const ref = new Date(refDate);
  const local = getZonedParts(ref, timeZone);

  const tomorrowMatch = lower.match(/tomorrow(?:\s+at\s+|\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (tomorrowMatch) {
    let hours = parseInt(tomorrowMatch[1] ?? "9", 10);
    const minutes = parseInt(tomorrowMatch[2] ?? "0", 10);
    const meridiem = tomorrowMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    const target = zonedDateTimeToUtc(
      local.year,
      local.month,
      local.day + 1,
      hours,
      minutes,
      timeZone,
    );
    return target.toISOString();
  }

  const todayMatch = lower.match(/today(?:\s+at\s+|\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (todayMatch) {
    let hours = parseInt(todayMatch[1] ?? "18", 10);
    const minutes = parseInt(todayMatch[2] ?? "0", 10);
    const meridiem = todayMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    const target = zonedDateTimeToUtc(local.year, local.month, local.day, hours, minutes, timeZone);
    return target.toISOString();
  }

  // Bare time match e.g. "at 4 pm" or "4:30 pm"
  const timeOnlyMatch = lower.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (timeOnlyMatch) {
    let hours = parseInt(timeOnlyMatch[1] ?? "9", 10);
    const minutes = parseInt(timeOnlyMatch[2] ?? "0", 10);
    const meridiem = timeOnlyMatch[3];
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    let target = zonedDateTimeToUtc(local.year, local.month, local.day, hours, minutes, timeZone);
    // If calculated time is already in the past relative to ref, assume tomorrow
    if (target.getTime() <= ref.getTime()) {
      target = zonedDateTimeToUtc(local.year, local.month, local.day + 1, hours, minutes, timeZone);
    }
    return target.toISOString();
  }

  return null;
}

/**
 * Parses natural-language reminder offset phrases into minutes.
 * Examples:
 *  - "remind me 5 minutes before" -> 5
 *  - "15 min prior" -> 15
 *  - "30 minutes before" -> 30
 *  - "half an hour before" -> 30
 *  - "1 hour before" -> 60
 *  - "2 hours before" -> 120
 *  - "1 day before" -> 1440
 *  - "at 4 PM" (with deadline at 5 PM) -> 60
 */
export function parseReminderOffset(
  input: unknown,
  deadlineIso?: string | null,
  referenceDateOrOptions: Date | DateNormalizeOptions = new Date(),
): number | null {
  if (!input || typeof input !== "string") {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
    return null;
  }

  const lower = trimmed.toLowerCase();

  // 1. Direct regex for "X min/mins/minutes/m before/prior/ahead"
  const minMatch = lower.match(
    /(\d+)\s*(?:min|mins|minute|minutes|m)\b(?:\s*(?:before|prior|ahead|of\s+deadline))?/,
  );
  if (minMatch && minMatch[1]) {
    const mins = parseInt(minMatch[1], 10);
    if (!isNaN(mins) && mins >= 0) return mins;
  }

  // 2. Direct regex for "X hour/hours/hr/hrs before/prior/ahead"
  const hourMatch = lower.match(
    /(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs|h)\b(?:\s*(?:before|prior|ahead|of\s+deadline))?/,
  );
  if (hourMatch && hourMatch[1]) {
    const hours = parseFloat(hourMatch[1]);
    if (!isNaN(hours) && hours >= 0) return Math.round(hours * 60);
  }

  // 3. Direct regex for "X day/days/d before/prior/ahead"
  const dayMatch = lower.match(
    /(\d+)\s*(?:day|days|d)\b(?:\s*(?:before|prior|ahead|of\s+deadline))?/,
  );
  if (dayMatch && dayMatch[1]) {
    const days = parseInt(dayMatch[1], 10);
    if (!isNaN(days) && days >= 0) return days * 1440;
  }

  // 4. Common phrases
  if (lower.includes("half an hour before") || lower.includes("half hour before")) {
    return 30;
  }
  if (lower.includes("an hour before") || lower.includes("one hour before")) {
    return 60;
  }
  if (lower.includes("a day before") || lower.includes("one day before")) {
    return 1440;
  }
  if (lower.includes("before the deadline") || lower.includes("before deadline")) {
    return 30; // sensible default
  }

  // 5. If absolute time given (e.g. "at 4 PM") and deadline is available:
  if (deadlineIso) {
    const deadlineTime = new Date(deadlineIso).getTime();
    if (!isNaN(deadlineTime)) {
      const parsedAbsolute = normalizeDate(trimmed, referenceDateOrOptions);
      if (parsedAbsolute) {
        const reminderTime = new Date(parsedAbsolute).getTime();
        if (!isNaN(reminderTime) && deadlineTime > reminderTime) {
          const diffMinutes = Math.round((deadlineTime - reminderTime) / 60000);
          if (diffMinutes > 0) return diffMinutes;
        }
      }
    }
  }

  return null;
}

/**
 * Calculates scheduled reminder ISO time:
 * scheduledReminderTime = deadline - offsetMinutes
 */
export function calculateScheduledReminderTime(
  deadlineIso: string | null | undefined,
  offsetMinutes: number | null | undefined,
  fallbackTimeIso?: string | null | undefined,
): string | null {
  if (deadlineIso && offsetMinutes != null && !isNaN(offsetMinutes)) {
    const deadlineMs = new Date(deadlineIso).getTime();
    if (!isNaN(deadlineMs)) {
      return new Date(deadlineMs - offsetMinutes * 60000).toISOString();
    }
  }

  if (fallbackTimeIso) {
    const fallbackMs = new Date(fallbackTimeIso).getTime();
    if (!isNaN(fallbackMs)) {
      return new Date(fallbackMs).toISOString();
    }
  }

  return null;
}
