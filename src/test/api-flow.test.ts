import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeDate } from "../server/date-utils";
import {
  ExtractionResultSchema,
  DumpRequestSchema,
  ConfirmProposalRequestSchema,
  type ExtractionResult,
} from "../server/types";
import { resetDbForTesting } from "../server/db";
import { handleApiRequest, setAiProvider, resetAiProvider } from "../server/api";
import type { AIProvider } from "../server/ai/provider";

class MockAiProvider implements AIProvider {
  name = "mock";
  async extract(content: string): Promise<ExtractionResult> {
    if (content.toLowerCase().includes("project report")) {
      return {
        tasks: [
          {
            title: "Submit the project report",
            deadline: "2026-10-07T17:00:00.000Z",
            priority: "high",
            evidence: "Submit the project report tomorrow at 5 PM.",
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

describe("Date Normalization", () => {
  it("parses and normalizes relative tomorrow time correctly", () => {
    const ref = new Date("2026-10-06T11:00:00.000Z");
    const normalized = normalizeDate("tomorrow at 5 PM", ref);
    expect(normalized).not.toBeNull();
    const parsed = new Date(normalized!);
    expect(parsed.getHours()).toBe(17);
  });

  it("handles valid ISO 8601 strings", () => {
    const iso = "2026-10-07T17:00:00.000Z";
    expect(normalizeDate(iso)).toBe(iso);
  });

  it("returns null for null, none, or empty strings", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate("none")).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});

describe("Zod Validation Schemas", () => {
  it("validates strict extraction schema", () => {
    const valid = {
      tasks: [
        {
          title: "Submit report",
          deadline: "2026-10-07T17:00:00.000Z",
          priority: "high",
          evidence: "Submit the report tomorrow at 5 PM",
        },
      ],
      memories: [
        {
          content: "Prefers morning meetings",
          category: "preference",
          evidence: "I prefer morning meetings",
        },
      ],
    };

    const res = ExtractionResultSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it("rejects extraction tasks without title or evidence", () => {
    const invalid = {
      tasks: [
        {
          title: "",
          evidence: "",
        },
      ],
      memories: [],
    };
    const res = ExtractionResultSchema.safeParse(invalid);
    expect(res.success).toBe(false);
  });
});

describe("Complete Vertical Slice API Flow", () => {
  beforeEach(() => {
    resetDbForTesting();
    setAiProvider(new MockAiProvider());
  });

  afterEach(() => {
    resetAiProvider();
  });

  it("GET /api/health returns 200 ok", async () => {
    const req = new Request("http://localhost/api/health", { method: "GET" });
    const res = await handleApiRequest(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBeDefined();
    expect(body.ai).toBeDefined();
  });

  it("POST /api/dump validates input payload", async () => {
    const req = new Request("http://localhost/api/dump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });
    const res = await handleApiRequest(req);
    expect(res.status).toBe(400);
  });

  it("Full Flow: Dump -> AI proposal -> Confirm -> Task in Dashboard", async () => {
    // 1. Submit dump
    const dumpReq = new Request("http://localhost/api/dump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Submit the project report tomorrow at 5 PM." }),
    });

    const dumpRes = await handleApiRequest(dumpReq);
    expect(dumpRes.status).toBe(201);
    const proposal = await dumpRes.json();

    expect(proposal.dumpId).toBeDefined();
    expect(proposal.proposalId).toBeDefined();
    expect(proposal.source.content).toBe("Submit the project report tomorrow at 5 PM.");
    expect(Array.isArray(proposal.tasks)).toBe(true);
    expect(proposal.tasks.length).toBeGreaterThan(0);

    const extractedTask = proposal.tasks[0];
    expect(extractedTask.title.toLowerCase()).toContain("project report");
    expect(extractedTask.evidence).toBeDefined();
    expect(extractedTask.deadline).not.toBeNull();

    // Verify task is NOT yet saved in actual tasks
    const tasksBeforeConfirmRes = await handleApiRequest(new Request("http://localhost/api/tasks"));
    const tasksBefore = await tasksBeforeConfirmRes.json();
    expect(tasksBefore.tasks.length).toBe(0);

    // 2. Confirm proposal
    const confirmReq = new Request("http://localhost/api/proposals/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dumpId: proposal.dumpId,
        proposalId: proposal.proposalId,
        tasks: [extractedTask],
        memories: [],
      }),
    });

    const confirmRes = await handleApiRequest(confirmReq);
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json();
    expect(confirmBody.success).toBe(true);
    expect(confirmBody.tasks.length).toBe(1);

    const savedTask = confirmBody.tasks[0];
    expect(savedTask.title).toBe(extractedTask.title);
    expect(savedTask.dumpId).toBe(proposal.dumpId);
    expect(savedTask.evidence).toBe(extractedTask.evidence);
    expect(savedTask.completed).toBe(false);

    // 3. Verify task appears in GET /api/tasks
    const tasksAfterRes = await handleApiRequest(new Request("http://localhost/api/tasks"));
    const tasksAfter = await tasksAfterRes.json();
    expect(tasksAfter.tasks.length).toBe(1);
    expect(tasksAfter.tasks[0]._id).toBe(savedTask._id);
    expect(tasksAfter.tasks[0].evidence).toBe(extractedTask.evidence);

    // 4. Update task completion status (PATCH /api/tasks/:id)
    const patchReq = new Request(`http://localhost/api/tasks/${savedTask._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    const patchRes = await handleApiRequest(patchReq);
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.task.completed).toBe(true);

    // 5. Delete task (DELETE /api/tasks/:id)
    const delReq = new Request(`http://localhost/api/tasks/${savedTask._id}`, {
      method: "DELETE",
    });
    const delRes = await handleApiRequest(delReq);
    expect(delRes.status).toBe(200);

    const tasksFinalRes = await handleApiRequest(new Request("http://localhost/api/tasks"));
    const tasksFinal = await tasksFinalRes.json();
    expect(tasksFinal.tasks.length).toBe(0);
  });

  it("Rejection Flow: Rejected proposal does not persist tasks", async () => {
    const dumpReq = new Request("http://localhost/api/dump", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Casual greeting with no tasks" }),
    });
    const dumpRes = await handleApiRequest(dumpReq);
    const proposal = await dumpRes.json();

    const rejectReq = new Request("http://localhost/api/proposals/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposalId: proposal.proposalId }),
    });
    const rejectRes = await handleApiRequest(rejectReq);
    expect(rejectRes.status).toBe(200);

    const tasksRes = await handleApiRequest(new Request("http://localhost/api/tasks"));
    const tasks = await tasksRes.json();
    expect(tasks.tasks.length).toBe(0);
  });
});
