import { MongoClient, type Db, ObjectId } from "mongodb";
import type {
  DumpEntity,
  ProposalEntity,
  TaskEntity,
  MemoryEntity,
  UpdateTaskInput,
  UpdateMemoryInput,
} from "./types";

export class DatabaseError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "DatabaseError";
    this.statusCode = statusCode;
  }
}

export interface DatabaseAdapter {
  isRealMongo: boolean;
  dumps: {
    insert: (doc: Omit<DumpEntity, "_id">) => Promise<DumpEntity>;
    findById: (id: string) => Promise<DumpEntity | null>;
  };
  proposals: {
    insert: (doc: Omit<ProposalEntity, "_id">) => Promise<ProposalEntity>;
    findById: (id: string) => Promise<ProposalEntity | null>;
    updateStatus: (id: string, status: ProposalEntity["status"]) => Promise<void>;
  };
  tasks: {
    insert: (doc: Omit<TaskEntity, "_id">) => Promise<TaskEntity>;
    findMany: (filter?: { dumpId?: string }) => Promise<TaskEntity[]>;
    findById: (id: string) => Promise<TaskEntity | null>;
    update: (id: string, partial: UpdateTaskInput) => Promise<TaskEntity | null>;
    delete: (id: string) => Promise<boolean>;
  };
  memories: {
    insert: (doc: Omit<MemoryEntity, "_id">) => Promise<MemoryEntity>;
    findMany: (filter?: { dumpId?: string }) => Promise<MemoryEntity[]>;
    findById: (id: string) => Promise<MemoryEntity | null>;
    update: (id: string, partial: UpdateMemoryInput) => Promise<MemoryEntity | null>;
    delete: (id: string) => Promise<boolean>;
  };
}

// In-Memory implementation for tests or dev fallback
class MemoryDatabaseAdapter implements DatabaseAdapter {
  isRealMongo = false;
  private dumpsMap = new Map<string, DumpEntity>();
  private proposalsMap = new Map<string, ProposalEntity>();
  private tasksMap = new Map<string, TaskEntity>();
  private memoriesMap = new Map<string, MemoryEntity>();
  private counter = 1;

  private generateId(): string {
    return (this.counter++).toString(16).padStart(24, "0");
  }

  dumps = {
    insert: async (doc: Omit<DumpEntity, "_id">): Promise<DumpEntity> => {
      const entity: DumpEntity = { ...doc, _id: this.generateId() };
      this.dumpsMap.set(entity._id, entity);
      return entity;
    },
    findById: async (id: string): Promise<DumpEntity | null> => {
      return this.dumpsMap.get(id) ?? null;
    },
  };

  proposals = {
    insert: async (doc: Omit<ProposalEntity, "_id">): Promise<ProposalEntity> => {
      const entity: ProposalEntity = { ...doc, _id: this.generateId() };
      this.proposalsMap.set(entity._id, entity);
      return entity;
    },
    findById: async (id: string): Promise<ProposalEntity | null> => {
      return this.proposalsMap.get(id) ?? null;
    },
    updateStatus: async (id: string, status: ProposalEntity["status"]): Promise<void> => {
      const p = this.proposalsMap.get(id);
      if (p) p.status = status;
    },
  };

  tasks = {
    insert: async (doc: Omit<TaskEntity, "_id">): Promise<TaskEntity> => {
      const entity: TaskEntity = { ...doc, _id: this.generateId() };
      this.tasksMap.set(entity._id, entity);
      return entity;
    },
    findMany: async (filter?: { dumpId?: string }): Promise<TaskEntity[]> => {
      const all = Array.from(this.tasksMap.values());
      if (filter?.dumpId) return all.filter((t) => t.dumpId === filter.dumpId);
      return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    findById: async (id: string): Promise<TaskEntity | null> => {
      return this.tasksMap.get(id) ?? null;
    },
    update: async (id: string, partial: UpdateTaskInput): Promise<TaskEntity | null> => {
      const existing = this.tasksMap.get(id);
      if (!existing) return null;
      const updated: TaskEntity = {
        ...existing,
        ...(partial.title !== undefined ? { title: partial.title } : {}),
        ...(partial.deadline !== undefined ? { deadline: partial.deadline } : {}),
        ...(partial.priority !== undefined ? { priority: partial.priority } : {}),
        ...(partial.completed !== undefined ? { completed: partial.completed } : {}),
        ...(partial.reminder !== undefined ? { reminder: partial.reminder } : {}),
        updatedAt: new Date().toISOString(),
      };
      this.tasksMap.set(id, updated);
      return updated;
    },
    delete: async (id: string): Promise<boolean> => {
      return this.tasksMap.delete(id);
    },
  };

  memories = {
    insert: async (doc: Omit<MemoryEntity, "_id">): Promise<MemoryEntity> => {
      const entity: MemoryEntity = { ...doc, _id: this.generateId() };
      this.memoriesMap.set(entity._id, entity);
      return entity;
    },
    findMany: async (filter?: { dumpId?: string }): Promise<MemoryEntity[]> => {
      const all = Array.from(this.memoriesMap.values());
      if (filter?.dumpId) return all.filter((m) => m.dumpId === filter.dumpId);
      return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    findById: async (id: string): Promise<MemoryEntity | null> => {
      return this.memoriesMap.get(id) ?? null;
    },
    update: async (id: string, partial: UpdateMemoryInput): Promise<MemoryEntity | null> => {
      const existing = this.memoriesMap.get(id);
      if (!existing) return null;
      const updated: MemoryEntity = {
        ...existing,
        ...(partial.content !== undefined ? { content: partial.content } : {}),
        ...(partial.category !== undefined ? { category: partial.category } : {}),
        updatedAt: new Date().toISOString(),
      };
      this.memoriesMap.set(id, updated);
      return updated;
    },
    delete: async (id: string): Promise<boolean> => {
      return this.memoriesMap.delete(id);
    },
  };
}

// MongoDB Implementation
class MongoDatabaseAdapter implements DatabaseAdapter {
  isRealMongo = true;
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  private toObjectId(id: string): ObjectId {
    try {
      return new ObjectId(id);
    } catch {
      throw new DatabaseError(`Invalid ID format: ${id}`, 400);
    }
  }

  dumps = {
    insert: async (doc: Omit<DumpEntity, "_id">): Promise<DumpEntity> => {
      const result = await this.db.collection("dumps").insertOne({ ...doc });
      return { ...doc, _id: result.insertedId.toHexString() };
    },
    findById: async (id: string): Promise<DumpEntity | null> => {
      const res = await this.db.collection("dumps").findOne({ _id: this.toObjectId(id) });
      if (!res) return null;
      return { ...(res as unknown as DumpEntity), _id: res._id.toHexString() };
    },
  };

  proposals = {
    insert: async (doc: Omit<ProposalEntity, "_id">): Promise<ProposalEntity> => {
      const result = await this.db.collection("proposals").insertOne({ ...doc });
      return { ...doc, _id: result.insertedId.toHexString() };
    },
    findById: async (id: string): Promise<ProposalEntity | null> => {
      const res = await this.db.collection("proposals").findOne({ _id: this.toObjectId(id) });
      if (!res) return null;
      return { ...(res as unknown as ProposalEntity), _id: res._id.toHexString() };
    },
    updateStatus: async (id: string, status: ProposalEntity["status"]): Promise<void> => {
      await this.db
        .collection("proposals")
        .updateOne({ _id: this.toObjectId(id) }, { $set: { status } });
    },
  };

  tasks = {
    insert: async (doc: Omit<TaskEntity, "_id">): Promise<TaskEntity> => {
      const result = await this.db.collection("tasks").insertOne({ ...doc });
      return { ...doc, _id: result.insertedId.toHexString() };
    },
    findMany: async (filter?: { dumpId?: string }): Promise<TaskEntity[]> => {
      const query = filter?.dumpId ? { dumpId: filter.dumpId } : {};
      const cursor = this.db.collection("tasks").find(query).sort({ createdAt: -1 });
      const docs = await cursor.toArray();
      return docs.map((d) => ({ ...(d as unknown as TaskEntity), _id: d._id.toHexString() }));
    },
    findById: async (id: string): Promise<TaskEntity | null> => {
      const res = await this.db.collection("tasks").findOne({ _id: this.toObjectId(id) });
      if (!res) return null;
      return { ...(res as unknown as TaskEntity), _id: res._id.toHexString() };
    },
    update: async (id: string, partial: UpdateTaskInput): Promise<TaskEntity | null> => {
      const res = await this.db
        .collection("tasks")
        .findOneAndUpdate(
          { _id: this.toObjectId(id) },
          { $set: { ...partial, updatedAt: new Date().toISOString() } },
          { returnDocument: "after" },
        );
      if (!res) return null;
      return { ...(res as unknown as TaskEntity), _id: res._id.toHexString() };
    },
    delete: async (id: string): Promise<boolean> => {
      const res = await this.db.collection("tasks").deleteOne({ _id: this.toObjectId(id) });
      return (res.deletedCount ?? 0) > 0;
    },
  };

  memories = {
    insert: async (doc: Omit<MemoryEntity, "_id">): Promise<MemoryEntity> => {
      const result = await this.db.collection("memories").insertOne({ ...doc });
      return { ...doc, _id: result.insertedId.toHexString() };
    },
    findMany: async (filter?: { dumpId?: string }): Promise<MemoryEntity[]> => {
      const query = filter?.dumpId ? { dumpId: filter.dumpId } : {};
      const cursor = this.db.collection("memories").find(query).sort({ createdAt: -1 });
      const docs = await cursor.toArray();
      return docs.map((d) => ({ ...(d as unknown as MemoryEntity), _id: d._id.toHexString() }));
    },
    findById: async (id: string): Promise<MemoryEntity | null> => {
      const res = await this.db.collection("memories").findOne({ _id: this.toObjectId(id) });
      if (!res) return null;
      return { ...(res as unknown as MemoryEntity), _id: res._id.toHexString() };
    },
    update: async (id: string, partial: UpdateMemoryInput): Promise<MemoryEntity | null> => {
      const res = await this.db
        .collection("memories")
        .findOneAndUpdate(
          { _id: this.toObjectId(id) },
          { $set: { ...partial, updatedAt: new Date().toISOString() } },
          { returnDocument: "after" },
        );
      if (!res) return null;
      return { ...(res as unknown as MemoryEntity), _id: res._id.toHexString() };
    },
    delete: async (id: string): Promise<boolean> => {
      const res = await this.db.collection("memories").deleteOne({ _id: this.toObjectId(id) });
      return (res.deletedCount ?? 0) > 0;
    },
  };
}

let cachedAdapter: DatabaseAdapter | null = null;
let clientPromise: Promise<MongoClient> | null = null;

export async function getDb(): Promise<DatabaseAdapter> {
  if (cachedAdapter) {
    return cachedAdapter;
  }

  const mongoUri = process.env["MONGODB_URI"];
  const dbName = process.env["MONGODB_DB_NAME"] || "stepout";
  const allowFallback =
    process.env["NODE_ENV"] === "test" || process.env["ALLOW_IN_MEMORY_DB"] === "true" || !mongoUri;

  if (mongoUri && mongoUri !== "memory") {
    try {
      if (!clientPromise) {
        const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 2500 });
        clientPromise = client.connect();
      }
      const client = await clientPromise;
      const db = client.db(dbName);
      cachedAdapter = new MongoDatabaseAdapter(db);
      return cachedAdapter;
    } catch (err: unknown) {
      clientPromise = null;
      const message = err instanceof Error ? err.message : String(err);
      if (allowFallback) {
        console.warn(
          `[Database] MongoDB connection failed (${message}), using in-memory store for development/testing.`,
        );
        cachedAdapter = new MemoryDatabaseAdapter();
        return cachedAdapter;
      }
      throw new DatabaseError(`Failed to connect to MongoDB: ${message}`, 503);
    }
  }

  // If no MONGODB_URI or explicitly memory
  if (allowFallback) {
    cachedAdapter = new MemoryDatabaseAdapter();
    return cachedAdapter;
  }

  throw new DatabaseError("MONGODB_URI is not configured in environment variables", 500);
}

export function resetDbForTesting(): void {
  cachedAdapter = new MemoryDatabaseAdapter();
}
