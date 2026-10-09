import { ZodError } from "zod";
import { getDb, DatabaseError } from "./db";
import { OllamaProvider } from "./ai/ollama";
import { AIProviderError, type AIProvider } from "./ai/provider";
import { extractTextFromImage, extractTextFromPdf, transcribeAudio } from "./multimodal";
import { normalizeDate, parseReminderOffset, calculateScheduledReminderTime } from "./date-utils";
import {
  DumpRequestSchema,
  ConfirmProposalRequestSchema,
  UpdateTaskSchema,
  UpdateMemorySchema,
  UpdateReminderStatusSchema,
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
    // GET /api/health or GET /health
    if ((path === "/api/health" || path === "/health") && method === "GET") {
      try {
        const db = await getDb();
        return jsonResponse({
          status: "ok",
          database: db.isRealMongo ? "mongodb" : "in-memory-fallback",
          ai: {
            provider: aiProvider.name,
            model: process.env["OLLAMA_MODEL"] || "gemma3:latest",
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Database unavailable";
        return jsonResponse(
          {
            status: "degraded",
            database: "unavailable",
            error: message,
            ai: {
              provider: aiProvider.name,
              model: process.env["OLLAMA_MODEL"] || "gemma3:latest",
            },
          },
          503,
        );
      }
    }

    // POST /api/dump - Extract proposal from raw user text, images, PDFs, or audio
    if (path === "/api/dump" && method === "POST") {
      const contentType = request.headers.get("content-type") || "";
      let rawText = "";
      let sourceType: "text" | "image" | "pdf" | "audio" = "text";
      let originalFileName: string | null = null;
      let userTimeZone: string | undefined;

      if (
        contentType.includes("multipart/form-data") ||
        Boolean((request as unknown as { _formData?: FormData })._formData)
      ) {
        let formData: FormData;
        try {
          formData =
            (request as unknown as { _formData?: FormData })._formData ??
            (await request.formData());
        } catch {
          return errorResponse("Failed to parse multipart form data", 400);
        }

        const file = formData.get("file");
        const formContent = (formData.get("content") as string | null) || "";
        userTimeZone = (formData.get("userTimeZone") as string | null) || undefined;

        const isFileLike = Boolean(
          file &&
          typeof file === "object" &&
          ("arrayBuffer" in file ||
            (typeof Blob !== "undefined" && (file as object) instanceof Blob) ||
            "size" in file),
        );

        if (isFileLike && file) {
          const fileObj = file as File;
          originalFileName = fileObj.name || (file as { name?: string }).name || null;
          const mime = (fileObj.type || "").toLowerCase();
          const ext = (originalFileName ? originalFileName.split(".").pop() : "")?.toLowerCase();

          let buffer: Buffer;
          if ("arrayBuffer" in fileObj && typeof fileObj.arrayBuffer === "function") {
            const arrayBuf = await fileObj.arrayBuffer();
            buffer = Buffer.from(arrayBuf);
          } else if (typeof FileReader !== "undefined" && fileObj instanceof Blob) {
            buffer = await new Promise<Buffer>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
              reader.onerror = () => reject(new Error("Failed to read file"));
              reader.readAsArrayBuffer(fileObj);
            });
          } else {
            buffer = Buffer.alloc(0);
          }

          if (buffer.length === 0) {
            return errorResponse("Uploaded file is empty (0 bytes).", 400);
          }
          if (buffer.length > 15 * 1024 * 1024) {
            return errorResponse("Uploaded file exceeds 15MB limit.", 400);
          }

          // Ingest based on file type
          if (
            mime.startsWith("image/") ||
            ["png", "jpg", "jpeg", "webp", "bmp"].includes(ext || "")
          ) {
            sourceType = "image";
            try {
              rawText = await extractTextFromImage(buffer);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              return errorResponse(msg, 400);
            }
          } else if (mime === "application/pdf" || ext === "pdf") {
            sourceType = "pdf";
            try {
              rawText = await extractTextFromPdf(buffer);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              const statusCode = msg.includes("no extractable text") ? 422 : 400;
              return errorResponse(msg, statusCode);
            }
          } else if (
            mime.startsWith("audio/") ||
            ["webm", "wav", "mp3", "m4a", "ogg", "aac"].includes(ext || "")
          ) {
            sourceType = "audio";
            try {
              rawText = await transcribeAudio(buffer, mime, formContent);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              return errorResponse(msg, 400);
            }
          } else {
            return errorResponse(`Unsupported file type: ${mime || ext || "unknown"}`, 400);
          }

          // If extra textual notes were also provided
          if (formContent && formContent.trim() && sourceType !== "audio") {
            rawText = `${rawText}\n\nUser Context: ${formContent.trim()}`;
          }
        } else if (formContent.trim()) {
          rawText = formContent.trim();
        } else {
          return errorResponse("Neither text nor file was provided in form data.", 400);
        }
      } else {
        // Standard JSON payload
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
        rawText = parsed.data.content;
        sourceType = parsed.data.sourceType || "text";
        userTimeZone = parsed.data.userTimeZone;
      }

      if (!rawText.trim()) {
        return errorResponse("No readable text could be obtained from the input.", 400);
      }

      const db = await getDb();
      const nowIso = new Date().toISOString();

      // 1. Save original dump / source in database
      const dumpRecord = await db.dumps.insert({
        content: rawText,
        sourceType,
        originalFileName,
        createdAt: nowIso,
      });

      // 2. Call AI extraction layer (canonical path for all modalities)
      const extraction = await aiProvider.extract(rawText, {
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
            sourceType: dumpRecord.sourceType,
            originalFileName: dumpRecord.originalFileName,
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

      const {
        dumpId,
        proposalId,
        tasks: approvedTasks,
        memories: approvedMemories,
        userTimeZone,
      } = parsed.data;
      const db = await getDb();
      const normOptions = { timeZone: userTimeZone };

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
          let offsetMinutes = t.reminder?.offsetMinutes ?? null;
          if (offsetMinutes === null && t.reminder) {
            offsetMinutes =
              parseReminderOffset(t.reminder.note, t.deadline, normOptions) ??
              parseReminderOffset(t.reminder.time, t.deadline, normOptions) ??
              parseReminderOffset(t.evidence, t.deadline, normOptions);
          } else if (offsetMinutes === null && t.evidence) {
            offsetMinutes = parseReminderOffset(t.evidence, t.deadline, normOptions);
          }

          let scheduledAt: string | null =
            (t.reminder as { scheduledAt?: string | null })?.scheduledAt ?? null;
          if (!scheduledAt && offsetMinutes !== null && t.deadline) {
            scheduledAt = calculateScheduledReminderTime(
              t.deadline,
              offsetMinutes,
              t.reminder?.time,
            );
          } else if (!scheduledAt && t.reminder?.time) {
            scheduledAt = normalizeDate(t.reminder.time, normOptions);
          }

          const hasReminder = Boolean(t.reminder || offsetMinutes !== null || scheduledAt);

          const inserted = await db.tasks.insert({
            dumpId,
            title: t.title,
            deadline: t.deadline ?? null,
            priority: t.priority ?? "medium",
            completed: false,
            evidence: t.evidence || dump.content,
            reminder: hasReminder
              ? {
                  time: t.reminder?.time ?? scheduledAt,
                  offsetMinutes: offsetMinutes ?? null,
                  note:
                    t.reminder?.note ??
                    (offsetMinutes !== null ? `${offsetMinutes} minutes before` : null),
                  status: "pending",
                  scheduledAt: scheduledAt ?? t.reminder?.time ?? null,
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

    // GET /api/reminders/due - Retrieve pending due reminders
    if (path === "/api/reminders/due" && method === "GET") {
      const db = await getDb();
      const beforeParam = url.searchParams.get("before");
      const reminders = await db.tasks.findDueReminders(beforeParam || undefined);
      return jsonResponse({ reminders });
    }

    // PATCH /api/reminders/:id - Update reminder status (e.g. sent, dismissed)
    if (path.startsWith("/api/reminders/") && method === "PATCH") {
      const id = path.slice("/api/reminders/".length);
      if (!id) return errorResponse("Reminder ID is required", 400);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("Invalid JSON payload", 400);
      }

      const parsed = UpdateReminderStatusSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse("Invalid status value", 400, parsed.error.issues);
      }

      const db = await getDb();
      const task = await db.tasks.findById(id);
      if (!task) {
        return errorResponse(`Task with ID ${id} not found`, 404);
      }

      const updated = await db.tasks.update(id, {
        reminder: {
          status: parsed.data.status,
          sentAt: parsed.data.status === "sent" ? new Date().toISOString() : task.reminder?.sentAt,
        },
      });

      return jsonResponse({ success: true, task: updated });
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
