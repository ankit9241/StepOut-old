import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { Page } from "@/components/site";
import type { TaskEntity, MemoryEntity, ExtractedTask, ExtractedMemory } from "@/server/types";
import {
  getNotificationPermission,
  requestNotificationPermission,
  triggerBrowserNotification,
  formatReminderNotification,
} from "@/lib/notifications";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — StepOut" },
      {
        name: "description",
        content:
          "Submit raw thoughts and let open-source AI extract actionable tasks and durable memories.",
      },
      { property: "og:title", content: "Dashboard — StepOut" },
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
    sourceType?: "text" | "image" | "pdf" | "audio";
    originalFileName?: string | null;
    createdAt: string;
  };
}

function Dashboard() {
  const [content, setContent] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isDumping, setIsDumping] = useState(false);
  const [dumpError, setDumpError] = useState<string | null>(null);

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() =>
    getNotificationPermission(),
  );
  const [dueAlerts, setDueAlerts] = useState<{ id: string; title: string; body: string }[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  // Periodic reminder checking (every 30s)
  useEffect(() => {
    let isCancelled = false;

    const checkDueReminders = async () => {
      try {
        const res = await fetch("/api/reminders/due");
        if (!res.ok) return;
        const data = (await res.json()) as { reminders?: TaskEntity[] };
        if (isCancelled || !data.reminders || data.reminders.length === 0) return;

        for (const task of data.reminders) {
          const { title, body } = formatReminderNotification(task);

          // 1. Trigger browser notification if permission granted
          triggerBrowserNotification(title, body);

          // 2. Add to in-app alerts banner (fallback / in-app view)
          setDueAlerts((prev) => {
            if (prev.some((a) => a.id === task._id)) return prev;
            return [...prev, { id: task._id, title, body }];
          });

          // 3. Mark as sent so it is not repeatedly triggered
          await fetch(`/api/reminders/${task._id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "sent" }),
          });
        }
      } catch (err) {
        console.warn("Error polling due reminders:", err);
      }
    };

    checkDueReminders();
    const interval = setInterval(checkDueReminders, 30000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  const speechRecognitionRef = useRef<unknown>(null);
  const speechTranscriptRef = useRef<string>("");

  // Voice recording toggle
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      speechTranscriptRef.current = "";
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      // Start optional browser SpeechRecognition for zero-cost instant voice-to-text
      const SpeechRecognitionClass =
        (
          window as unknown as {
            SpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              onresult: (e: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void;
              start: () => void;
              stop: () => void;
            };
            webkitSpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              onresult: (e: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void;
              start: () => void;
              stop: () => void;
            };
          }
        ).SpeechRecognition ||
        (
          window as unknown as {
            webkitSpeechRecognition?: new () => {
              continuous: boolean;
              interimResults: boolean;
              lang: string;
              onresult: (e: { results: { isFinal: boolean; 0: { transcript: string } }[] }) => void;
              start: () => void;
              stop: () => void;
            };
          }
        ).webkitSpeechRecognition;

      if (SpeechRecognitionClass) {
        try {
          const recognizer = new SpeechRecognitionClass();
          recognizer.continuous = true;
          recognizer.interimResults = true;
          recognizer.lang = navigator.language || "en-US";
          recognizer.onresult = (event) => {
            let finalTranscript = "";
            for (let i = 0; i < event.results.length; ++i) {
              const item = event.results[i];
              if (item?.isFinal && item[0]?.transcript) {
                finalTranscript += item[0].transcript + " ";
              }
            }
            if (finalTranscript.trim()) {
              speechTranscriptRef.current = finalTranscript.trim();
            }
          };
          recognizer.start();
          speechRecognitionRef.current = recognizer;
        } catch (e) {
          console.warn("SpeechRecognition not initialized:", e);
        }
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const voiceFile = new File([audioBlob], `voice-note-${Date.now()}.webm`, {
          type: "audio/webm",
        });
        setSelectedFile(voiceFile);
        if (speechTranscriptRef.current.trim() && !content.trim()) {
          setContent(speechTranscriptRef.current.trim());
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      console.error("Microphone access failed:", err);
      setDumpError(
        "Could not access microphone. Please ensure microphone permissions are allowed.",
      );
    }
  };

  const stopRecording = () => {
    if (speechRecognitionRef.current) {
      try {
        (speechRecognitionRef.current as { stop: () => void }).stop();
      } catch {
        // Ignore stop error
      }
      speechRecognitionRef.current = null;
    }

    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const handleRequestPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
  };

  // Handle Dump Submission
  const handleDumpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!content.trim() && !selectedFile) || isDumping) return;

    try {
      setIsDumping(true);
      setDumpError(null);
      setProposal(null);

      let res: Response;
      const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        if (content.trim()) {
          formData.append("content", content.trim());
        }
        formData.append("userTimeZone", userTimeZone);

        res = await fetch("/api/dump", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/dump", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: content.trim(), userTimeZone }),
        });
      }

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

      // Clear input and attachments upon successful proposal creation
      setContent("");
      setSelectedFile(null);
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
          userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      {/* Due Reminder Alerts Banner */}
      {dueAlerts.length > 0 && (
        <section className="mb-10 max-w-4xl border-l-4 border-primary bg-secondary/80 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="label !text-primary font-semibold text-sm">🔔 Due Reminder</span>
            <button onClick={() => setDueAlerts([])} className="link-quiet text-xs">
              Dismiss All
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {dueAlerts.map((alert) => (
              <div key={alert.id} className="border-t border-border/40 pt-2 text-sm">
                <p className="font-semibold text-foreground">{alert.title}</p>
                <p className="text-xs text-muted-foreground whitespace-pre-line">{alert.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Notification permission prompt */}
      {notificationPermission === "default" && (
        <div className="mb-6 flex max-w-4xl items-center justify-between border border-border/60 bg-secondary/30 px-4 py-3 text-xs">
          <span>Enable browser notifications to receive task reminders when they become due.</span>
          <button onClick={handleRequestPermission} className="btn !py-1 !px-3 text-xs">
            Enable Notifications
          </button>
        </div>
      )}

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
              placeholder="e.g. Submit the project report tomorrow at 5 PM and remind me 30 minutes before."
              className="field mt-3 text-xl leading-relaxed"
              disabled={isDumping}
            />
          </label>

          {/* File attachment preview */}
          {selectedFile && (
            <div className="mt-3 flex items-center justify-between border border-primary/30 bg-secondary/40 px-3 py-2 text-xs">
              <span className="truncate">
                📎 <strong className="font-semibold">{selectedFile.name}</strong> (
                {(selectedFile.size / 1024).toFixed(1)} KB)
              </span>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="link-quiet text-xs text-primary"
              >
                Remove
              </button>
            </div>
          )}

          {/* Action buttons bar for multimodal inputs */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn !py-2 !px-3 text-xs"
              disabled={isDumping}
            >
              📎 Attach Image, PDF or Audio
            </button>

            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              className={`btn !py-2 !px-3 text-xs ${isRecording ? "!bg-primary !text-primary-foreground animate-pulse" : ""}`}
              disabled={isDumping}
            >
              {isRecording ? `⏹ Stop Recording (${recordingSeconds}s)` : "🎙 Record Voice Note"}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf,.pdf,audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setSelectedFile(file);
                }
                e.target.value = "";
              }}
            />
          </div>

          {dumpError && (
            <div className="mt-4 border-l-2 border-primary bg-secondary/50 p-4 text-sm text-foreground">
              <span className="label !text-primary block font-semibold">Extraction Failed</span>
              <p className="mt-1">{dumpError}</p>
            </div>
          )}

          <div className="mt-6 flex items-center gap-6">
            <button
              type="submit"
              disabled={isDumping || (!content.trim() && !selectedFile)}
              className="btn"
            >
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
                        {typeof task.reminder.offsetMinutes === "number"
                          ? `(${task.reminder.offsetMinutes}m before)`
                          : ""}{" "}
                        {task.reminder.note ? `[${task.reminder.note}]` : ""}
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
                          {task.reminder && (
                            <p className="mt-1 text-xs text-muted-foreground font-mono">
                              Reminder:{" "}
                              {task.reminder.time ||
                                (typeof task.reminder.offsetMinutes === "number"
                                  ? `${task.reminder.offsetMinutes}m before`
                                  : "Set")}{" "}
                              <span
                                className={`uppercase font-semibold text-[10px] px-1 py-0.5 border ${
                                  task.reminder.status === "sent"
                                    ? "border-primary text-primary"
                                    : "border-border text-muted-foreground"
                                }`}
                              >
                                {task.reminder.status || "pending"}
                              </span>
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
