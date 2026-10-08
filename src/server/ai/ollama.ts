import { ExtractionResultSchema, type ExtractionResult } from "../types";
import { normalizeDate } from "../date-utils";
import { AIProviderError, type AIProvider, type ExtractionOptions } from "./provider";

export class OllamaProvider implements AIProvider {
  name = "ollama";
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(options?: { baseUrl?: string; model?: string; timeoutMs?: number }) {
    this.baseUrl = (
      options?.baseUrl ||
      process.env["OLLAMA_BASE_URL"] ||
      "http://127.0.0.1:11434"
    ).replace(/\/+$/, "");
    this.model = options?.model || process.env["OLLAMA_MODEL"] || "gemma3:latest";
    this.timeoutMs = options?.timeoutMs || 45000;
  }

  async extract(content: string, options?: ExtractionOptions): Promise<ExtractionResult> {
    const referenceDate = options?.referenceDate || new Date();
    const prompt = this.buildPrompt(referenceDate);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let rawJson: unknown;

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: {
            type: "object",
            properties: {
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    deadline: { type: "string" },
                    priority: { type: "string", enum: ["low", "medium", "high"] },
                    evidence: { type: "string" },
                    reminder: {
                      type: "object",
                      properties: {
                        time: { type: "string" },
                        note: { type: "string" },
                      },
                    },
                  },
                  required: ["title", "priority", "evidence"],
                },
              },
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    content: { type: "string" },
                    category: { type: "string" },
                    evidence: { type: "string" },
                  },
                  required: ["content", "category", "evidence"],
                },
              },
            },
            required: ["tasks", "memories"],
          },
          messages: [
            {
              role: "system",
              content: prompt,
            },
            {
              role: "user",
              content,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new AIProviderError(
          `Ollama returned HTTP ${response.status}: ${errorText || response.statusText}`,
          response.status >= 500 ? 502 : 400,
        );
      }

      const payload = (await response.json()) as { message?: { content?: string } };
      const rawContent = payload.message?.content;

      if (!rawContent || typeof rawContent !== "string") {
        throw new AIProviderError("Ollama returned an empty response", 502);
      }

      rawJson = this.parseJsonSafe(rawContent);
    } catch (error: unknown) {
      if (error instanceof AIProviderError) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new AIProviderError("AI request timed out", 504);
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ECONNREFUSED") || message.includes("Failed to fetch")) {
        throw new AIProviderError(
          `Cannot connect to Ollama at ${this.baseUrl}. Please verify Ollama is running.`,
          503,
        );
      }
      throw new AIProviderError(`Failed to communicate with Ollama: ${message}`, 500);
    } finally {
      clearTimeout(timeoutId);
    }

    // Validate structured JSON with Zod schema
    const validationResult = ExtractionResultSchema.safeParse(rawJson);
    if (!validationResult.success) {
      // Safely handle malformed AI output
      console.warn("AI output schema validation warning:", validationResult.error.format());
      throw new AIProviderError(
        `AI produced invalid structured output: ${validationResult.error.issues.map((i) => i.message).join(", ")}`,
        502,
      );
    }

    // Post-process & normalize dates and deadlines
    const normalizedTasks = validationResult.data.tasks.map((task) => {
      const normDeadline = task.deadline ? normalizeDate(task.deadline, referenceDate) : null;
      const normReminderTime = task.reminder?.time
        ? normalizeDate(task.reminder.time, referenceDate)
        : null;

      return {
        ...task,
        deadline: normDeadline,
        reminder: task.reminder
          ? {
              time: normReminderTime,
              note: task.reminder.note ?? null,
            }
          : null,
      };
    });

    return {
      tasks: normalizedTasks,
      memories: validationResult.data.memories,
    };
  }

  private buildPrompt(referenceDate: Date): string {
    const isoNow = referenceDate.toISOString();
    return `You are an intelligent knowledge extraction assistant.
Current Reference Time: ${isoNow} (${referenceDate.toString()}).

Your task:
Analyze the user's raw dump and extract:
1. Actionable TASKS (action items, todos, deadlines).
2. Durable MEMORIES (preferences, important facts, notes worth remembering long-term).
3. Ignore irrelevant casual remarks, chatter, or empty fluff.

STRICT RULES:
- Output MUST be valid JSON adhering exactly to the schema.
- Every task and memory MUST include an "evidence" field quoting the verbatim sentence or fragment from the input that justifies it.
- If a relative deadline is mentioned (e.g. "tomorrow at 5 PM", "by Friday", "in 2 hours"), compute its ISO-8601 string based on Current Reference Time: ${isoNow}.
- If no deadline is specified for a task, set "deadline": null.
- Priority must be one of: "low", "medium", "high". Default to "medium" unless specified.
- Memory category should be: "work", "personal", "preference", "fact", or "general".
- If no tasks are present, return "tasks": [].
- If no memories are present, return "memories": [].

Schema:
{
  "tasks": [
    {
      "title": "Clear concise action",
      "deadline": "ISO-8601 string or null",
      "priority": "low" | "medium" | "high",
      "evidence": "verbatim user text",
      "reminder": { "time": "ISO-8601 string or null", "note": "string or null" } | null
    }
  ],
  "memories": [
    {
      "content": "Durable knowledge or note",
      "category": "work" | "personal" | "preference" | "fact" | "general",
      "evidence": "verbatim user text"
    }
  ]
}`;
  }

  private parseJsonSafe(text: string): unknown {
    const cleaned = text.trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Try extracting markdown block ```json ... ```
      const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match && match[1]) {
        try {
          return JSON.parse(match[1]);
        } catch {
          // Fall through
        }
      }
      throw new AIProviderError("Model did not return valid JSON", 502);
    }
  }
}
