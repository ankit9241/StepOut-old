import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseReminderOffset,
  calculateScheduledReminderTime,
  normalizeDate,
} from "../server/date-utils";
import { resetDbForTesting, getDb, closeDbForTesting } from "../server/db";
import { handleApiRequest, setAiProvider, resetAiProvider } from "../server/api";
import { setOcrEngine, resetOcrEngine } from "../server/multimodal/ocr";
import { setPdfParser, resetPdfParser } from "../server/multimodal/pdf";
import { setAudioTranscriber, resetAudioTranscriber } from "../server/multimodal/audio";
import type { AIProvider } from "../server/ai/provider";
import { OllamaProvider } from "../server/ai/ollama";
import type { ExtractionResult } from "../server/types";

class MockExtractionSpy implements AIProvider {
  name = "mock-spy";
  lastExtractedContent: string | null = null;

  async extract(content: string): Promise<ExtractionResult> {
    this.lastExtractedContent = content;
    if (content.toLowerCase().includes("report")) {
      return {
        tasks: [
          {
            title: "Submit report",
            deadline: "2026-10-10T17:00:00.000Z",
            priority: "high",
            evidence: content,
            reminder: {
              time: "30 minutes before",
              offsetMinutes: 30,
              note: "prep submission",
            },
          },
        ],
        memories: [],
      };
    }

    if (content.toLowerCase().includes("coffee")) {
      return {
        tasks: [
          {
            title: "Buy coffee beans",
            deadline: null,
            priority: "low",
            evidence: content,
            reminder: null,
          },
        ],
        memories: [],
      };
    }

    return {
      tasks: [],
      memories: [],
    };
  }
}

describe("Phase 2: Reminder Natural Language Parsing & Scheduling", () => {
  it("Requirement 5: parses 'remind me 5 minutes before' to 5 minutes", () => {
    expect(parseReminderOffset("remind me 5 minutes before")).toBe(5);
    expect(parseReminderOffset("5 min before")).toBe(5);
    expect(parseReminderOffset("5 mins")).toBe(5);
  });

  it("Requirement 6: parses 'remind me 30 minutes before' to 30 minutes", () => {
    expect(parseReminderOffset("remind me 30 minutes before")).toBe(30);
    expect(parseReminderOffset("30 minutes before")).toBe(30);
    expect(parseReminderOffset("half an hour before")).toBe(30);
  });

  it("Requirement 7: parses 'remind me 2 hours before' to 120 minutes", () => {
    expect(parseReminderOffset("remind me 2 hours before")).toBe(120);
    expect(parseReminderOffset("2 hours before")).toBe(120);
    expect(parseReminderOffset("1 hour before")).toBe(60);
    expect(parseReminderOffset("1 day before")).toBe(1440);
  });

  it("Requirement 8: Deadline + reminder calculates the correct scheduled time", () => {
    const deadlineIso = "2026-10-10T17:00:00.000Z"; // 5:00 PM UTC
    const scheduled30Min = calculateScheduledReminderTime(deadlineIso, 30);
    expect(scheduled30Min).toBe("2026-10-10T16:30:00.000Z"); // 4:30 PM UTC

    const scheduled2Hours = calculateScheduledReminderTime(deadlineIso, 120);
    expect(scheduled2Hours).toBe("2026-10-10T15:00:00.000Z"); // 3:00 PM UTC

    const scheduled5Min = calculateScheduledReminderTime(deadlineIso, 5);
    expect(scheduled5Min).toBe("2026-10-10T16:55:00.000Z");
  });

  it("Timezone: parses Asia/Kolkata 'tomorrow at 5 PM' accurately relative to a UTC server reference", () => {
    // Reference instant: 2026-10-09T08:00:00.000Z (which is 1:30 PM in Kolkata)
    const refUtc = new Date("2026-10-09T08:00:00.000Z");
    const normalized = normalizeDate("tomorrow at 5 PM", {
      referenceDate: refUtc,
      timeZone: "Asia/Kolkata",
    });

    expect(normalized).not.toBeNull();
    // 5:00 PM on 2026-10-10 in Asia/Kolkata (UTC+5:30) is 11:30 AM UTC on 2026-10-10:
    expect(normalized).toBe("2026-10-10T11:30:00.000Z");

    // Reminder offset calculation with 30 min before
    const offset = parseReminderOffset("remind me 30 minutes before", normalized, {
      referenceDate: refUtc,
      timeZone: "Asia/Kolkata",
    });
    expect(offset).toBe(30);

    const scheduled = calculateScheduledReminderTime(normalized!, offset!);
    // 11:30 UTC - 30 min = 11:00 UTC (which is 4:30 PM in Kolkata):
    expect(scheduled).toBe("2026-10-10T11:00:00.000Z");
  });

  it("Timezone: parses America/New_York 'tomorrow at 5 PM' accurately relative to a UTC server reference", () => {
    const refUtc = new Date("2026-10-09T08:00:00.000Z"); // 4:00 AM in NY
    const normalized = normalizeDate("tomorrow at 5 PM", {
      referenceDate: refUtc,
      timeZone: "America/New_York",
    });

    expect(normalized).not.toBeNull();
    // 5:00 PM on 2026-10-10 in America/New_York (EDT, UTC-4) is 9:00 PM UTC on 2026-10-10:
    expect(normalized).toBe("2026-10-10T21:00:00.000Z");
  });
});

describe("Phase 2: Multimodal Ingestion Pipeline", () => {
  let spyProvider: MockExtractionSpy;

  beforeEach(() => {
    resetDbForTesting();
    spyProvider = new MockExtractionSpy();
    setAiProvider(spyProvider);
  });

  afterEach(() => {
    resetAiProvider();
    resetOcrEngine();
    resetPdfParser();
    resetAudioTranscriber();
  });

  it("Requirement 1: Text dump still works", async () => {
    const req = new Request("http://localhost/api/dump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Submit report tomorrow at 5 PM." }),
    });

    const res = await handleApiRequest(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.dumpId).toBeDefined();
    expect(body.tasks.length).toBe(1);
    expect(spyProvider.lastExtractedContent).toBe("Submit report tomorrow at 5 PM.");
  });

  it("Requirement 2: Image preprocessing reaches the same extraction pipeline", async () => {
    setOcrEngine(async (_buffer) => "Submit quarterly report by end of day");

    const formData = new FormData();
    const fakeImage = new Blob(["fake-image-bytes"], { type: "image/png" });
    formData.append("file", fakeImage, "screenshot.png");

    const req = new Request("http://localhost/api/dump", {
      method: "POST",
      body: formData,
    });
    (req as unknown as { _formData: FormData })._formData = formData;

    const res = await handleApiRequest(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source.sourceType).toBe("image");
    expect(body.source.originalFileName).toBe("screenshot.png");
    expect(spyProvider.lastExtractedContent).toContain("Submit quarterly report by end of day");
    expect(body.tasks.length).toBe(1);
  });

  it("Requirement 3: PDF preprocessing reaches the same extraction pipeline", async () => {
    setPdfParser(async (_buffer) => "Annual report summary and tasks");

    const formData = new FormData();
    const fakePdf = new Blob(["%PDF-1.4 mock content"], { type: "application/pdf" });
    formData.append("file", fakePdf, "document.pdf");

    const req = new Request("http://localhost/api/dump", {
      method: "POST",
      body: formData,
    });
    (req as unknown as { _formData: FormData })._formData = formData;

    const res = await handleApiRequest(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source.sourceType).toBe("pdf");
    expect(body.source.originalFileName).toBe("document.pdf");
    expect(spyProvider.lastExtractedContent).toContain("Annual report summary and tasks");
    expect(body.tasks.length).toBe(1);
  });

  it("PDF handling: Empty/scanned PDF without text returns graceful 422 user error", async () => {
    setPdfParser(async (_buffer) => ""); // Empty text

    const formData = new FormData();
    const fakePdf = new Blob(["%PDF-1.4 mock content"], { type: "application/pdf" });
    formData.append("file", fakePdf, "scanned.pdf");

    const req = new Request("http://localhost/api/dump", {
      method: "POST",
      body: formData,
    });
    (req as unknown as { _formData: FormData })._formData = formData;

    const res = await handleApiRequest(req);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain("no extractable text");
  });

  it("Requirement 4: Audio preprocessing reaches the same extraction pipeline", async () => {
    setAudioTranscriber(async (_buffer, _mime) => "Voice note: Buy coffee beans this evening");

    const formData = new FormData();
    const fakeAudio = new Blob(["fake-audio-bytes"], { type: "audio/webm" });
    formData.append("file", fakeAudio, "recording.webm");

    const req = new Request("http://localhost/api/dump", {
      method: "POST",
      body: formData,
    });
    (req as unknown as { _formData: FormData })._formData = formData;

    const res = await handleApiRequest(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.source.sourceType).toBe("audio");
    expect(spyProvider.lastExtractedContent).toContain("Voice note: Buy coffee beans this evening");
    expect(body.tasks[0].title).toBe("Buy coffee beans");
  });
});

describe("Phase 2: Reminder Scheduling & Due Notifications", () => {
  let spyProvider: MockExtractionSpy;

  beforeEach(() => {
    resetDbForTesting();
    spyProvider = new MockExtractionSpy();
    setAiProvider(spyProvider);
  });

  afterEach(() => {
    resetAiProvider();
  });

  it("Requirement 9 & 10: Due reminder returned by endpoint and sent reminder not returned again", async () => {
    // 1. Ingest dump
    const dumpReq = new Request("http://localhost/api/dump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Submit report tomorrow at 5 PM." }),
    });
    const dumpRes = await handleApiRequest(dumpReq);
    const proposal = await dumpRes.json();

    // 2. Confirm task with reminder scheduled in the past / currently due
    const pastScheduledTime = new Date(Date.now() - 5000).toISOString(); // 5 seconds ago
    const confirmedTask = {
      ...proposal.tasks[0],
      reminder: {
        time: "30 minutes before",
        offsetMinutes: 30,
        note: "prep submission",
        status: "pending",
        scheduledAt: pastScheduledTime,
      },
    };

    const confirmReq = new Request("http://localhost/api/proposals/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dumpId: proposal.dumpId,
        proposalId: proposal.proposalId,
        tasks: [confirmedTask],
        memories: [],
      }),
    });
    const confirmRes = await handleApiRequest(confirmReq);
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json();
    const createdTask = confirmBody.tasks[0];
    expect(createdTask._id).toBeDefined();

    // Requirement 9: Due reminder is returned by GET /api/reminders/due
    const dueReq = new Request("http://localhost/api/reminders/due");
    const dueRes = await handleApiRequest(dueReq);
    expect(dueRes.status).toBe(200);
    const dueBody = await dueRes.json();
    expect(dueBody.reminders.length).toBe(1);
    expect(dueBody.reminders[0]._id).toBe(createdTask._id);
    expect(dueBody.reminders[0].title).toBe("Submit report");
    expect(dueBody.reminders[0].reminder.status).toBe("pending");

    // Mark reminder as sent via PATCH /api/reminders/:id
    const patchReq = new Request(`http://localhost/api/reminders/${createdTask._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "sent" }),
    });
    const patchRes = await handleApiRequest(patchReq);
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.task.reminder.status).toBe("sent");

    // Requirement 10: A sent reminder is NOT returned again
    const dueAgainRes = await handleApiRequest(new Request("http://localhost/api/reminders/due"));
    expect(dueAgainRes.status).toBe(200);
    const dueAgainBody = await dueAgainRes.json();
    expect(dueAgainBody.reminders.length).toBe(0);
  });
});

describe("Phase 2 Production Database Rules", () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    await closeDbForTesting();
    resetDbForTesting();
  });

  it("Production mode disables silent in-memory fallback when MONGODB_URI is missing", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["MONGODB_URI"];
    process.env["ALLOW_IN_MEMORY_DB"] = "true"; // should be ignored in production
    await closeDbForTesting();

    await expect(getDb()).rejects.toThrow("MONGODB_URI is not configured in environment variables");
  });

  it("Production mode throws 503 when connection to MongoDB fails", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["MONGODB_URI"] = "mongodb://127.0.0.1:54321/nonexistent";
    process.env["ALLOW_IN_MEMORY_DB"] = "true"; // should be ignored in production
    await closeDbForTesting();

    await expect(getDb()).rejects.toThrow("Failed to connect to MongoDB");
  });
});

describe("Render Production Health & Ollama Readiness", () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
    await closeDbForTesting();
    resetDbForTesting();
  });

  it("GET /health and GET /api/health return 200 with database and AI details", async () => {
    const res1 = await handleApiRequest(new Request("http://localhost/health"));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.status).toBe("ok");
    expect(body1.database).toBeDefined();
    expect(body1.ai).toBeDefined();

    const res2 = await handleApiRequest(new Request("http://localhost/api/health"));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.status).toBe("ok");
  });

  it("GET /health returns 503 degraded when MongoDB connection fails in production", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["MONGODB_URI"] = "mongodb://127.0.0.1:54321/nonexistent";
    await closeDbForTesting();

    const res = await handleApiRequest(new Request("http://localhost/health"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("unavailable");
    expect(body.error).toContain("Failed to connect to MongoDB");
    // Ensure no sensitive credentials leaked
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("OllamaProvider reads OLLAMA_TIMEOUT_MS and catches connection errors with 503", async () => {
    process.env["OLLAMA_BASE_URL"] = "http://127.0.0.1:54322";
    process.env["OLLAMA_TIMEOUT_MS"] = "2000";
    const provider = new OllamaProvider();
    await expect(provider.extract("test content")).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("Cannot connect to Ollama"),
    });
  });
});
