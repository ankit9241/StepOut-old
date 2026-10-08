import { ZodError } from "zod";
import { getDb, DatabaseError } from "./db";
import { OllamaProvider } from "./ai/ollama";
import { AIProviderError, type AIProvider } from "./ai/provider";
import {
  DumpRequestSchema,
  ConfirmProposalRequestSchema,
  UpdateTaskSchema,
  UpdateMemorySchema,
  type ExtractedTask,
  type ExtractedMemory,
  type TaskEntity,
  type MemoryEntity,
} from "./types";

let aiProvider: AIProvider = new OllamaProvider();

export function setAiProvider(provider: AIProvider): void {
  aiProvider = provider;
}

export function resetAiProvider(): void {
  aiProvider = new OllamaProvider();
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function errorResponse(message: string, status = 500, details?: unknown): Response {
  return jsonResponse({ error: message, ...(details ? { details } : {}) }, status);
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  try {
    // GET /api/health
    if (path === "/api/health" && method === "GET") {
      const db = await getDb();
      return jsonResponse({
        status: "ok",
        database: db.isRealMongo ? "mongodb" : "in-memory-fallback",
        ai: {
          provider: aiProvider.name,
          model: process.env["OLLAMA_MODEL"] || "gemma3:latest",
        },
      });
    }

    // POST /api/dump - Extract proposal from raw user text
    if (path === "/api/dump" && method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload in request body", 400);
      }

      const parsed = DumpRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(
          parsed.error.issues[0]?.message || "Invalid dump payload",
          400,
          parsed.error.issues,
        );
      }

      const db = await getDb();
      const nowIso = new Date().toISOString();

      // 1. Save original dump / source in database
      const dumpRecord = await db.dumps.insert({
        content: parsed.data.content,
        createdAt: nowIso,
      });

      // 2. Call AI extraction layer
      const extraction = await aiProvider.extract(parsed.data.content, {
        referenceDate: new Date(),
      });

      // 3. Save proposal record as pending (do NOT automatically commit items yet)
      const proposalRecord = await db.proposals.insert({
        dumpId: dumpRecord._id,
        tasks: extraction.tasks,
        memories: extraction.memories,
        status: "pending",
        createdAt: nowIso,
      });

      // 4. Return structured proposal
      return jsonResponse(
        {
          proposalId: proposalRecord._id,
          dumpId: dumpRecord._id,
          tasks: extraction.tasks,
          memories: extraction.memories,
          source: {
            id: dumpRecord._id,
            content: dumpRecord.content,
            createdAt: dumpRecord.createdAt,
          },
        },
        201,
      );
    }

    // POST /api/proposals/confirm or POST /api/dump/confirm - Commit approved tasks and memories
    if ((path === "/api/proposals/confirm" || path === "/api/dump/confirm") && method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload in request body", 400);
      }

      const parsed = ConfirmProposalRequestSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse("Invalid confirmation payload", 400, parsed.error.issues);
      }

      const { dumpId, proposalId, tasks: approvedTasks, memories: approvedMemories } = parsed.data;
      const db = await getDb();

      // Ensure original dump source exists
      const dump = await db.dumps.findById(dumpId);
      if (!dump) {
        return errorResponse(`Original dump source not found for id: ${dumpId}`, 404);
      }

      // Update proposal status if proposalId provided
      if (proposalId) {
        await db.proposals.updateStatus(proposalId, "confirmed");
      }

      const nowIso = new Date().toISOString();
      const savedTasks: TaskEntity[] = [];
      const savedMemories: MemoryEntity[] = [];

      // Avoid duplicate records: fetch existing items for this dump
      const existingTasks = await db.tasks.findMany({ dumpId });
      const existingMemories = await db.memories.findMany({ dumpId });

      for (const t of approvedTasks) {
        const isDuplicate = existingTasks.some(
          (et) =>
            et.title.trim().toLowerCase() === t.title.trim().toLowerCase() &&
            et.deadline === (t.deadline ?? null),
        );
        if (!isDuplicate) {
          const inserted = await db.tasks.insert({
            dumpId,
            title: t.title,
            deadline: t.deadline ?? null,
            priority: t.priority ?? "medium",
            completed: false,
            evidence: t.evidence || dump.content,
            reminder: t.reminder
              ? {
                  time: t.reminder.time ?? null,
                  note: t.reminder.note ?? null,
                }
              : null,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          savedTasks.push(inserted);
        }
      }

      for (const m of approvedMemories) {
        const isDuplicate = existingMemories.some(
          (em) => em.content.trim().toLowerCase() === m.content.trim().toLowerCase(),
        );
        if (!isDuplicate) {
          const inserted = await db.memories.insert({
            dumpId,
            content: m.content,
            category: m.category || "general",
            evidence: m.evidence || dump.content,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          savedMemories.push(inserted);
        }
      }

      return jsonResponse({
        success: true,
        dumpId,
        tasks: savedTasks,
        memories: savedMemories,
      });
    }

    // POST /api/proposals/reject - Reject proposal without saving items
    if (path === "/api/proposals/reject" && method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const proposalId = (body as { proposalId?: string })?.proposalId;
      if (!proposalId) {
        return errorResponse("proposalId is required", 400);
      }

      const db = await getDb();
      await db.proposals.updateStatus(proposalId, "rejected");

      return jsonResponse({
        success: true,
        message: "Proposal rejected. No tasks or memories were saved.",
      });
    }

    // GET /api/tasks - List all tasks
    if (path === "/api/tasks" && method === "GET") {
      const db = await getDb();
      const tasks = await db.tasks.findMany();
      return jsonResponse({ tasks });
    }

    // PATCH /api/tasks/:id - Update task
    if (path.startsWith("/api/tasks/") && method === "PATCH") {
      const id = path.slice("/api/tasks/".length);
      if (!id) return errorResponse("Task ID is required", 400);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const parsed = UpdateTaskSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse("Invalid update fields", 400, parsed.error.issues);
      }

      const db = await getDb();
      const updated = await db.tasks.update(id, parsed.data);
      if (!updated) {
        return errorResponse(`Task with ID ${id} not found`, 404);
      }

      return jsonResponse({ success: true, task: updated });
    }

    // DELETE /api/tasks/:id - Delete task
    if (path.startsWith("/api/tasks/") && method === "DELETE") {
      const id = path.slice("/api/tasks/".length);
      if (!id) return errorResponse("Task ID is required", 400);

      const db = await getDb();
      const deleted = await db.tasks.delete(id);
      if (!deleted) {
        return errorResponse(`Task with ID ${id} not found`, 404);
      }

      return jsonResponse({ success: true, id });
    }

    // GET /api/memories - List all memories
    if (path === "/api/memories" && method === "GET") {
      const db = await getDb();
      const memories = await db.memories.findMany();
      return jsonResponse({ memories });
    }

    // PATCH /api/memories/:id - Update memory
    if (path.startsWith("/api/memories/") && method === "PATCH") {
      const id = path.slice("/api/memories/".length);
      if (!id) return errorResponse("Memory ID is required", 400);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const parsed = UpdateMemorySchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse("Invalid update fields", 400, parsed.error.issues);
      }

      const db = await getDb();
      const updated = await db.memories.update(id, parsed.data);
      if (!updated) {
        return errorResponse(`Memory with ID ${id} not found`, 404);
      }

      return jsonResponse({ success: true, memory: updated });
    }

    // DELETE /api/memories/:id - Delete memory
    if (path.startsWith("/api/memories/") && method === "DELETE") {
      const id = path.slice("/api/memories/".length);
      if (!id) return errorResponse("Memory ID is required", 400);

      const db = await getDb();
      const deleted = await db.memories.delete(id);
      if (!deleted) {
        return errorResponse(`Memory with ID ${id} not found`, 404);
      }

      return jsonResponse({ success: true, id });
    }

    return errorResponse(`Route not found: ${method} ${path}`, 404);
  } catch (err: unknown) {
    if (err instanceof AIProviderError) {
      return errorResponse(err.message, err.statusCode);
    }
    if (err instanceof DatabaseError) {
      return errorResponse(err.message, err.statusCode);
    }
    if (err instanceof ZodError) {
      return errorResponse("Validation error", 400, err.issues);
    }

    const message = err instanceof Error ? err.message : "Internal Server Error";
    console.error(`[API Error] ${method} ${path}:`, err);
    return errorResponse(message, 500);
  }
}
