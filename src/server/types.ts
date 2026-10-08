import { z } from "zod";

// Zod schemas for AI extraction and request validation
export const ExtractedTaskSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  deadline: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  evidence: z.string().min(1, "Evidence is required"),
  reminder: z
    .object({
      time: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const ExtractedMemorySchema = z.object({
  content: z.string().min(1, "Memory content is required"),
  category: z.string().default("general"),
  evidence: z.string().min(1, "Evidence is required"),
});

export const ExtractionResultSchema = z.object({
  tasks: z.array(ExtractedTaskSchema).default([]),
  memories: z.array(ExtractedMemorySchema).default([]),
});

export const DumpRequestSchema = z.object({
  content: z.string().min(1, "Content cannot be empty"),
});

export const ConfirmProposalRequestSchema = z.object({
  dumpId: z.string().min(1, "dumpId is required"),
  proposalId: z.string().optional(),
  tasks: z.array(ExtractedTaskSchema).default([]),
  memories: z.array(ExtractedMemorySchema).default([]),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  deadline: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  completed: z.boolean().optional(),
  reminder: z
    .object({
      time: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const UpdateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  category: z.string().optional(),
});

export type ExtractedTask = z.infer<typeof ExtractedTaskSchema>;
export type ExtractedMemory = z.infer<typeof ExtractedMemorySchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// Database Entities
export interface DumpEntity {
  _id: string;
  content: string;
  createdAt: string;
}

export interface ProposalEntity {
  _id: string;
  dumpId: string;
  tasks: ExtractedTask[];
  memories: ExtractedMemory[];
  status: "pending" | "confirmed" | "rejected";
  createdAt: string;
}

export interface TaskEntity {
  _id: string;
  dumpId: string;
  title: string;
  deadline: string | null;
  priority: "low" | "medium" | "high";
  completed: boolean;
  evidence: string;
  reminder?:
    | {
        time?: string | null | undefined;
        note?: string | null | undefined;
      }
    | null
    | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntity {
  _id: string;
  dumpId: string;
  content: string;
  category: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}

export type UpdateTaskInput = {
  title?: string | undefined;
  deadline?: string | null | undefined;
  priority?: "low" | "medium" | "high" | undefined;
  completed?: boolean | undefined;
  reminder?:
    | {
        time?: string | null | undefined;
        note?: string | null | undefined;
      }
    | null
    | undefined;
};

export type UpdateMemoryInput = {
  content?: string | undefined;
  category?: string | undefined;
};
