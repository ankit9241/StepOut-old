import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { Page } from "@/components/site";
import type { TaskEntity, MemoryEntity, ExtractedTask, ExtractedMemory } from "@/server/types";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Mind Dump & Memory" },
      {
        name: "description",
        content:
          "Submit raw thoughts and let open-source AI extract actionable tasks and durable memories.",
      },
      { property: "og:title", content: "Dashboard — Mind Dump" },
    ],
  }),
  component: Dashboard,
});

interface ProposalState {
  proposalId: string;
  dumpId: string;
  tasks: (ExtractedTask & { approved: boolean })[];
  memories: (ExtractedMemory & { approved: boolean })[];
  source: {
    id: string;
    content: string;
    createdAt: string;
  };
}

function Dashboard() {
  const [content, setContent] = useState("");
  const [isDumping, setIsDumping] = useState(false);
  const [dumpError, setDumpError] = useState<string | null>(null);

  const [proposal, setProposal] = useState<ProposalState | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<TaskEntity[]>([]);
  const [memories, setMemories] = useState<MemoryEntity[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  // Fetch real persisted tasks and memories
  const loadData = useCallback(async () => {
    try {
      setIsLoadingData(true);
      setDataError(null);

      const [tasksRes, memoriesRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/memories"),
      ]);

      if (!tasksRes.ok || !memoriesRes.ok) {
        throw new Error("Failed to fetch tasks or memories from server");
      }

      const tasksData = (await tasksRes.json()) as { tasks: TaskEntity[] };
      const memoriesData = (await memoriesRes.json()) as { memories: MemoryEntity[] };

      setTasks(tasksData.tasks || []);
      setMemories(memoriesData.memories || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDataError(msg);
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Dump Submission
  const handleDumpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isDumping) return;

    try {
      setIsDumping(true);
      setDumpError(null);
      setProposal(null);

      const res = await fetch("/api/dump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process dump");
      }

      setProposal({
        proposalId: data.proposalId,
        dumpId: data.dumpId,
        tasks: (data.tasks || []).map((t: ExtractedTask) => ({ ...t, approved: true })),
        memories: (data.memories || []).map((m: ExtractedMemory) => ({ ...m, approved: true })),
        source: data.source,
      });

      // Clear input upon successful proposal creation
      setContent("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDumpError(msg);
    } finally {
      setIsDumping(false);
    }
  };

  // Toggle approval state for proposed items
  const toggleTaskApproval = (index: number) => {
    if (!proposal) return;
    const updated = [...proposal.tasks];
    updated[index] = { ...updated[index]!, approved: !updated[index]!.approved };
    setProposal({ ...proposal, tasks: updated });
  };

  const updateProposedTask = (index: number, patch: Partial<ExtractedTask>) => {
    if (!proposal) return;
    const updated = [...proposal.tasks];
    updated[index] = { ...updated[index]!, ...patch };
    setProposal({ ...proposal, tasks: updated });
  };

  const toggleMemoryApproval = (index: number) => {
    if (!proposal) return;
    const updated = [...proposal.memories];
    updated[index] = { ...updated[index]!, approved: !updated[index]!.approved };
    setProposal({ ...proposal, memories: updated });
  };

  const updateProposedMemory = (index: number, patch: Partial<ExtractedMemory>) => {
    if (!proposal) return;
    const updated = [...proposal.memories];
    updated[index] = { ...updated[index]!, ...patch };
    setProposal({ ...proposal, memories: updated });
  };

  // Confirm approved items
  const handleConfirm = async () => {
    if (!proposal || isConfirming) return;

    try {
      setIsConfirming(true);
      setConfirmError(null);

      const approvedTasks = proposal.tasks
        .filter((t) => t.approved)
        .map(({ approved: _, ...rest }) => rest);

      const approvedMemories = proposal.memories
        .filter((m) => m.approved)
        .map(({ approved: _, ...rest }) => rest);

      const res = await fetch("/api/proposals/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dumpId: proposal.dumpId,
          proposalId: proposal.proposalId,
          tasks: approvedTasks,
          memories: approvedMemories,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to confirm proposal");
      }

      // Close proposal and reload real lists
      setProposal(null);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setConfirmError(msg);
    } finally {
      setIsConfirming(false);
    }
  };

  // Reject proposal completely
  const handleReject = async () => {
    if (!proposal) return;

    try {
      await fetch("/api/proposals/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId: proposal.proposalId }),
      });
    } catch {
      // Discard proposal on client regardless
    }
    setProposal(null);
  };

  // Toggle completion on a real task
  const handleToggleTask = async (task: TaskEntity) => {
    try {
      const res = await fetch(`/api/tasks/${task._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !task.completed }),
      });
      if (res.ok) {
        const data = (await res.json()) as { task: TaskEntity };
        setTasks((prev) => prev.map((t) => (t._id === task._id ? data.task : t)));
      }
    } catch (err) {
      console.error("Failed to toggle task:", err);
    }
  };

  // Delete task
  const handleDeleteTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t._id !== id));
      }
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  };

  // Delete memory
  const handleDeleteMemory = async (id: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
      if (res.ok) {
        setMemories((prev) => prev.filter((m) => m._id !== id));
      }
    } catch (err) {
      console.error("Failed to delete memory:", err);
    }
  };

  return (
    <Page>
      {/* Header section */}
      <section className="max-w-4xl">
        <p className="label rise">Second Brain / Core Intelligence</p>
        <h1 className="display rise-2 mt-4 text-5xl md:text-7xl">
          Mind Dump & <em className="text-primary">Extraction.</em>
        </h1>
        <p className="rise-3 mt-4 text-lg text-muted-foreground">
          Type or paste raw thoughts, deadlines, or meeting notes. Open-source AI extracts
          structured tasks and memories for review.
        </p>
      </section>

      {/* Input Dump Form */}
      <section className="rise-4 mt-12 max-w-4xl border-t pt-8">
        <form onSubmit={handleDumpSubmit}>
          <label className="block">
            <span className="label">Raw Input Dump</span>
            <textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="e.g. Submit the project report tomorrow at 5 PM."
              className="field mt-3 text-xl leading-relaxed"
              disabled={isDumping}
            />
          </label>

          {dumpError && (
            <div className="mt-4 border-l-2 border-primary bg-secondary/50 p-4 text-sm text-foreground">
              <span className="label !text-primary block font-semibold">Extraction Failed</span>
              <p className="mt-1">{dumpError}</p>
            </div>
          )}

          <div className="mt-6 flex items-center gap-6">
            <button type="submit" disabled={isDumping || !content.trim()} className="btn">
              {isDumping ? "Extracting with AI..." : "Process Dump →"}
            </button>
            {isDumping && <span className="label animate-pulse">Running Ollama Model...</span>}
          </div>
        </form>
      </section>

      {/* AI Proposal Review / Confirmation Section */}
      {proposal && (
        <section className="rise mt-16 max-w-4xl border-t-2 border-primary/40 pt-10">
          <div className="flex items-baseline justify-between border-b pb-4">
            <div>
              <p className="label !text-primary">AI Structured Proposal</p>
              <h2 className="display mt-2 text-3xl md:text-4xl">Review Extracted Items</h2>
            </div>
            <span className="label">Pending Confirmation</span>
          </div>

          <div className="mt-6 bg-secondary/30 p-4 text-sm">
            <span className="label block">Original Source Dump</span>
            <p className="mt-2 italic text-foreground">“{proposal.source.content}”</p>
          </div>

          {/* Proposed Tasks */}
          <div className="mt-10">
            <h3 className="label text-base font-semibold">
              Proposed Tasks ({proposal.tasks.length})
            </h3>
            {proposal.tasks.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No actionable tasks detected in this dump.
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                {proposal.tasks.map((task, idx) => (
                  <div
                    key={`task-${idx}`}
                    className={`border p-6 transition-colors ${
                      task.approved
                        ? "border-primary/50 bg-background"
                        : "border-border/50 opacity-50 bg-secondary/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={task.approved}
                          onChange={() => toggleTaskApproval(idx)}
                          className="h-4 w-4 rounded accent-primary"
                        />
                        <span className="label">{task.approved ? "Approved" : "Excluded"}</span>
                      </label>
                      <span className="label uppercase">Priority: {task.priority}</span>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <span className="label">Title</span>
                        <input
                          type="text"
                          value={task.title}
                          onChange={(e) => updateProposedTask(idx, { title: e.target.value })}
                          className="field mt-1 text-lg font-medium"
                        />
                      </div>
                      <div>
                        <span className="label">Deadline</span>
                        <input
                          type="text"
                          value={task.deadline || ""}
                          onChange={(e) =>
                            updateProposedTask(idx, { deadline: e.target.value || null })
                          }
                          placeholder="No deadline"
                          className="field mt-1 text-sm text-muted-foreground"
                        />
                      </div>
                    </div>

                    <div className="mt-4 border-t pt-3">
                      <span className="label">Evidence</span>
                      <p className="mt-1 text-xs text-muted-foreground italic">“{task.evidence}”</p>
                    </div>

                    {task.reminder?.time && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        <span className="label">Reminder:</span> {task.reminder.time}{" "}
                        {task.reminder.note ? `(${task.reminder.note})` : ""}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Proposed Memories */}
          <div className="mt-12">
            <h3 className="label text-base font-semibold">
              Proposed Memories ({proposal.memories.length})
            </h3>
            {proposal.memories.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No durable memories detected in this dump.
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                {proposal.memories.map((mem, idx) => (
                  <div
                    key={`mem-${idx}`}
                    className={`border p-6 transition-colors ${
                      mem.approved
                        ? "border-primary/50 bg-background"
                        : "border-border/50 opacity-50 bg-secondary/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mem.approved}
                          onChange={() => toggleMemoryApproval(idx)}
                          className="h-4 w-4 rounded accent-primary"
                        />
                        <span className="label">{mem.approved ? "Approved" : "Excluded"}</span>
                      </label>
                      <span className="label uppercase">Category: {mem.category}</span>
                    </div>

                    <div className="mt-4">
                      <span className="label">Content</span>
                      <input
                        type="text"
                        value={mem.content}
                        onChange={(e) => updateProposedMemory(idx, { content: e.target.value })}
                        className="field mt-1 text-base"
                      />
                    </div>

                    <div className="mt-4 border-t pt-3">
                      <span className="label">Evidence</span>
                      <p className="mt-1 text-xs text-muted-foreground italic">“{mem.evidence}”</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {confirmError && (
            <div className="mt-6 border-l-2 border-primary bg-secondary/50 p-4 text-sm text-foreground">
              <span className="label !text-primary block font-semibold">
                Error Confirming Proposal
              </span>
              <p className="mt-1">{confirmError}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-10 flex flex-wrap items-center gap-6 border-t pt-8">
            <button
              onClick={handleConfirm}
              disabled={
                isConfirming ||
                (!proposal.tasks.some((t) => t.approved) &&
                  !proposal.memories.some((m) => m.approved))
              }
              className="btn"
            >
              {isConfirming ? "Persisting..." : "Confirm Approved Items →"}
            </button>
            <button onClick={handleReject} disabled={isConfirming} className="link-quiet text-sm">
              Discard Proposal
            </button>
          </div>
        </section>
      )}

      {/* Real Confirmed Tasks & Memories Lists */}
      <section className="mt-20 max-w-4xl border-t pt-14">
        <div className="grid gap-12 md:grid-cols-2">
          {/* Confirmed Tasks List */}
          <div>
            <div className="flex items-baseline justify-between border-b pb-4">
              <h2 className="display text-3xl">Tasks</h2>
              <span className="label">{tasks.length} total</span>
            </div>

            {isLoadingData ? (
              <p className="mt-6 text-sm text-muted-foreground animate-pulse">Loading tasks...</p>
            ) : dataError ? (
              <p className="mt-6 text-sm text-primary">{dataError}</p>
            ) : tasks.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No tasks saved yet. Submit a dump to create one.
              </p>
            ) : (
              <ul className="mt-6 space-y-4">
                {tasks.map((task) => (
                  <li key={task._id} className="border-b pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1">
                        <input
                          type="checkbox"
                          checked={task.completed}
                          onChange={() => handleToggleTask(task)}
                          className="mt-1 h-4 w-4 cursor-pointer rounded accent-primary"
                        />
                        <div>
                          <p
                            className={`text-lg font-medium leading-snug ${
                              task.completed
                                ? "line-through text-muted-foreground"
                                : "text-foreground"
                            }`}
                          >
                            {task.title}
                          </p>
                          {task.deadline && (
                            <p className="mt-1 text-xs text-primary font-mono">
                              Deadline: {new Date(task.deadline).toLocaleString()}
                            </p>
                          )}
                          <p className="mt-2 text-xs text-muted-foreground italic">
                            Evidence: “{task.evidence}”
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteTask(task._id)}
                        className="link-quiet text-xs text-muted-foreground hover:text-primary"
                        title="Delete task"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Confirmed Memories List */}
          <div>
            <div className="flex items-baseline justify-between border-b pb-4">
              <h2 className="display text-3xl">Memories</h2>
              <span className="label">{memories.length} total</span>
            </div>

            {isLoadingData ? (
              <p className="mt-6 text-sm text-muted-foreground animate-pulse">
                Loading memories...
              </p>
            ) : memories.length === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                No memories saved yet. Submit notes or preferences.
              </p>
            ) : (
              <ul className="mt-6 space-y-4">
                {memories.map((mem) => (
                  <li key={mem._id} className="border-b pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <span className="label block uppercase">{mem.category}</span>
                        <p className="mt-1 text-base text-foreground">{mem.content}</p>
                        <p className="mt-2 text-xs text-muted-foreground italic">
                          Evidence: “{mem.evidence}”
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteMemory(mem._id)}
                        className="link-quiet text-xs text-muted-foreground hover:text-primary"
                        title="Delete memory"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </Page>
  );
}
