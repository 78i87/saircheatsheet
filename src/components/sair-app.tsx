"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  CheatsheetRecord,
  ProblemRecord,
  RunBatchStatus,
  RunBatchDetail,
  RunBatchSummary,
} from "@/lib/contracts";
import {
  CHEATSHEET_SIZE_ERROR,
  getCheatsheetContentSizeBytes,
  isCheatsheetContentTooLarge,
  MAX_CHEATSHEET_BYTES,
} from "@/lib/cheatsheet";
import {
  SUPPORTED_MODELS,
  supportsLowReasoning,
  type Difficulty,
  type ReasoningMode,
} from "@/lib/models";
import { formatStoredResponse } from "@/lib/run-output";

type AppTab = "run" | "history";
type CheatsheetDraft = {
  id?: number;
  name: string;
  content: string;
};

const GPT_OSS_120B_MODEL_ID = "openai/gpt-oss-120b";

function buildCheatsheetPreview(cheatsheetContent: string) {
  const cheatsheetSection = cheatsheetContent.trim()
    ? `\n${cheatsheetContent.trim()}\n`
    : "\n";

  return [
    "You are a mathematician specializing in equational theories of magmas.",
    "Your task is to determine whether Equation 1 (<eq1>) implies Equation 2 (<eq2>) over all magmas.",
    cheatsheetSection.trimEnd(),
    "",
    "Output format (use exact headers without any additional text or formatting):",
    "VERDICT: must be exactly TRUE or FALSE (in the same line).",
    "REASONING: must be non-empty.",
    "PROOF: required if VERDICT is TRUE, empty otherwise.",
    "COUNTEREXAMPLE: required if VERDICT is FALSE, empty otherwise.",
  ]
    .filter((line, index, array) => {
      if (line !== "") {
        return true;
      }
      return array[index - 1] !== "";
    })
    .join("\n");
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return "--";
  }
  return `$${value.toFixed(4)}`;
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "--";
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatDateTime(iso: string | null) {
  if (!iso) {
    return "--";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function shouldShowReasoningDetails(modelId: string, rawReasoning: string | null) {
  return modelId === GPT_OSS_120B_MODEL_ID || Boolean(rawReasoning?.trim());
}

function isBatchActive(batch: Pick<RunBatchSummary, "status" | "finishedAt">) {
  return (
    (batch.status === "queued" || batch.status === "running") &&
    batch.finishedAt === null
  );
}

function wasBatchStopped(
  batch: Pick<RunBatchSummary, "stopRequestedAt" | "finishedAt" | "completedCount" | "totalCount">,
) {
  return (
    batch.stopRequestedAt !== null &&
    batch.finishedAt !== null &&
    batch.completedCount < batch.totalCount
  );
}

function getBatchStatusLabel(batch: RunBatchSummary | RunBatchDetail) {
  if (batch.stopRequestedAt && isBatchActive(batch)) {
    return "stopping";
  }

  if (wasBatchStopped(batch)) {
    return "stopped";
  }

  return batch.status;
}

function getBatchStatusTone(batch: RunBatchSummary | RunBatchDetail): RunBatchStatus {
  if (batch.stopRequestedAt && isBatchActive(batch)) {
    return "running";
  }

  if (wasBatchStopped(batch)) {
    return "failed";
  }

  return batch.status;
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Ignore JSON parse failures.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function StatsCard({
  label,
  value,
  accent = "neutral",
}: {
  label: string;
  value: string;
  accent?: "neutral" | "good" | "focus";
}) {
  return (
    <article className={`stat-card stat-card--${accent}`}>
      <span className="stat-card__value">{value}</span>
      <span className="stat-card__label">{label}</span>
    </article>
  );
}

function CopyableDetails({
  summary,
  content,
}: {
  summary: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        window.clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content);
    setCopied(true);

    if (resetTimeoutRef.current !== null) {
      window.clearTimeout(resetTimeoutRef.current);
    }

    resetTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimeoutRef.current = null;
    }, 1500);
  }, [content]);

  return (
    <details className="details-block details-block--copyable">
      <summary>{summary}</summary>
      <button
        type="button"
        className="details-block__copy-button"
        aria-label={copied ? "Copied" : `Copy ${summary.toLowerCase().replace(/^show\s+/, "")}`}
        title={copied ? "Copied" : "Copy"}
        onClick={handleCopy}
      >
        {copied ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M9.55 18.2 4.8 13.45l1.4-1.4 3.35 3.35 8.25-8.25 1.4 1.4-9.65 9.65Z"
              fill="currentColor"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M16.5 3H8a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8.5a2 2 0 0 0 2-2V5.5L16.5 3ZM8 5h8l1.5 1.5V18a.5.5 0 0 1-.5.5H8a.5.5 0 0 1-.5-.5V5.5A.5.5 0 0 1 8 5Zm1 4h6v1H9V9Zm0 3h6v1H9v-1Zm0 3h6v1H9v-1Zm0 3h4v1H9v-1Z"
              fill="currentColor"
              fillRule="evenodd"
            />
          </svg>
        )}
      </button>
      <pre>{content}</pre>
    </details>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <p className="empty-state__eyebrow">Awaiting a batch</p>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

const CheatsheetModal = memo(function CheatsheetModal({
  initialDraft,
  saving,
  onClose,
  onSave,
}: {
  initialDraft: CheatsheetDraft;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: CheatsheetDraft) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const backdropPointerStartedRef = useRef(false);
  const cheatsheetPreview = useMemo(
    () => buildCheatsheetPreview(draft.content),
    [draft.content],
  );
  const contentSizeBytes = useMemo(
    () => getCheatsheetContentSizeBytes(draft.content),
    [draft.content],
  );
  const contentTooLarge = contentSizeBytes > MAX_CHEATSHEET_BYTES;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        backdropPointerStartedRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const shouldClose =
          backdropPointerStartedRef.current && event.target === event.currentTarget;
        backdropPointerStartedRef.current = false;
        if (shouldClose) {
          onClose();
        }
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={draft.id ? "Edit cheatsheet" : "New cheatsheet"}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel__header">
          <div>
            <h2>{draft.id ? "Edit Cheatsheet" : "New Cheatsheet"}</h2>
          </div>
        </div>

        <input
          className="field"
          placeholder="Title"
          value={draft.name}
          onChange={(event) =>
            setDraft((current) => ({ ...current, name: event.target.value }))
          }
        />

        <textarea
          className="textarea textarea--cheatsheet"
          placeholder="Cheatsheet content..."
          value={draft.content}
          onChange={(event) =>
            setDraft((current) => ({ ...current, content: event.target.value }))
          }
        />
        <p className="section-meta">
          Plain text only. {contentSizeBytes} / {MAX_CHEATSHEET_BYTES} bytes.
          {contentTooLarge ? ` ${CHEATSHEET_SIZE_ERROR}` : ""}
        </p>

        <div className="preview-block">
          <h3>Prompt preview:</h3>
          <pre>{cheatsheetPreview}</pre>
        </div>

        <div className="modal__actions">
          <button className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="run-button run-button--inline"
            disabled={!draft.name.trim() || saving || contentTooLarge}
            onClick={() => onSave(draft)}
          >
            {saving
              ? draft.id
                ? "Saving..."
                : "Creating..."
              : draft.id
                ? "Save"
                : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
});

export function SairApp() {
  const [tab, setTab] = useState<AppTab>("run");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [problems, setProblems] = useState<ProblemRecord[]>([]);
  const [cheatsheets, setCheatsheets] = useState<CheatsheetRecord[]>([]);
  const [batches, setBatches] = useState<RunBatchSummary[]>([]);

  const [selectedDifficulty, setSelectedDifficulty] =
    useState<Difficulty>("normal");
  const [search, setSearch] = useState("");
  const [selectedProblemIds, setSelectedProblemIds] = useState<number[]>([]);
  const [selectedCheatsheetId, setSelectedCheatsheetId] = useState<number | null>(
    null,
  );
  const [selectedModelId, setSelectedModelId] = useState<string>(
    SUPPORTED_MODELS[0].id,
  );
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>("default");

  const [currentBatchId, setCurrentBatchId] = useState<number | null>(null);
  const [currentBatch, setCurrentBatch] = useState<RunBatchDetail | null>(null);
  const [historyBatchId, setHistoryBatchId] = useState<number | null>(null);
  const [historyBatch, setHistoryBatch] = useState<RunBatchDetail | null>(null);

  const [historyDifficultyFilter, setHistoryDifficultyFilter] = useState<
    "all" | Difficulty
  >("all");
  const [historyModelFilter, setHistoryModelFilter] = useState<string>("all");
  const [historyCorrectnessFilter, setHistoryCorrectnessFilter] = useState<
    "all" | "perfect" | "partial" | "failed"
  >("all");
  const [historyDateFilter, setHistoryDateFilter] = useState("");

  const [draft, setDraft] = useState<CheatsheetDraft | null>(null);
  const [submittingRun, setSubmittingRun] = useState(false);
  const [savingCheatsheet, setSavingCheatsheet] = useState(false);
  const [stoppingBatchId, setStoppingBatchId] = useState<number | null>(null);

  const supportsReasoning = supportsLowReasoning(selectedModelId);

  const visibleProblems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return problems.filter((problem) => {
      if (problem.difficulty !== selectedDifficulty) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        problem.datasetId.toLowerCase().includes(query) ||
        problem.equation1.toLowerCase().includes(query) ||
        problem.equation2.toLowerCase().includes(query)
      );
    });
  }, [problems, search, selectedDifficulty]);

  const selectedCount = selectedProblemIds.length;
  const visibleSelectedCount = visibleProblems.filter((problem) =>
    selectedProblemIds.includes(problem.id),
  ).length;
  const selectedCheatsheet = cheatsheets.find(
    (entry) => entry.id === selectedCheatsheetId,
  );

  const historyBatches = useMemo(() => {
    return batches.filter((batch) => {
      if (
        historyDifficultyFilter !== "all" &&
        !batch.difficulties.includes(historyDifficultyFilter)
      ) {
        return false;
      }

      if (historyModelFilter !== "all" && batch.modelId !== historyModelFilter) {
        return false;
      }

      if (historyCorrectnessFilter === "perfect" && batch.accuracy !== 1) {
        return false;
      }

      if (
        historyCorrectnessFilter === "partial" &&
        (batch.accuracy === null || batch.accuracy === 1 || batch.accuracy === 0)
      ) {
        return false;
      }

      if (
        historyCorrectnessFilter === "failed" &&
        batch.status !== "failed" &&
        batch.accuracy !== 0
      ) {
        return false;
      }

      if (
        historyDateFilter &&
        !batch.startedAt.startsWith(historyDateFilter.trim())
      ) {
        return false;
      }

      return true;
    });
  }, [
    batches,
    historyCorrectnessFilter,
    historyDateFilter,
    historyDifficultyFilter,
    historyModelFilter,
  ]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [problemResponse, cheatsheetResponse, batchResponse] = await Promise.all([
        requestJson<{ problems: ProblemRecord[] }>("/api/problems"),
        requestJson<{ cheatsheets: CheatsheetRecord[] }>("/api/cheatsheets"),
        requestJson<{ batches: RunBatchSummary[] }>("/api/runs"),
      ]);

      setProblems(problemResponse.problems);
      setCheatsheets(cheatsheetResponse.cheatsheets);
      setBatches(batchResponse.batches);

      if (batchResponse.batches.length > 0) {
        setHistoryBatchId((current) => current ?? batchResponse.batches[0].id);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load app.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBatchSummaries = useCallback(async () => {
    const payload = await requestJson<{ batches: RunBatchSummary[] }>("/api/runs");
    setBatches(payload.batches);
  }, []);

  const loadBatchDetail = useCallback(
    async (batchId: number, target: "current" | "history") => {
      const payload = await requestJson<{ batch: RunBatchDetail }>(`/api/runs/${batchId}`);

      if (target === "current") {
        setCurrentBatch(payload.batch);
      } else {
        setHistoryBatch(payload.batch);
      }

      setBatches((existing) => {
        const next = existing.map((entry) =>
          entry.id === payload.batch.id ? payload.batch : entry,
        );
        return next.some((entry) => entry.id === payload.batch.id)
          ? next
          : [payload.batch, ...existing];
      });
    },
    [],
  );

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!supportsReasoning && reasoningMode !== "default") {
      setReasoningMode("default");
    }
  }, [reasoningMode, supportsReasoning]);

  useEffect(() => {
    if (currentBatchId === null) {
      return;
    }

    void loadBatchDetail(currentBatchId, "current");
  }, [currentBatchId, loadBatchDetail]);

  useEffect(() => {
    if (historyBatchId === null) {
      return;
    }

    void loadBatchDetail(historyBatchId, "history");
  }, [historyBatchId, loadBatchDetail]);

  useEffect(() => {
    if (!currentBatchId || !currentBatch) {
      return;
    }

    if (!isBatchActive(currentBatch)) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadBatchDetail(currentBatchId, "current");
      void refreshBatchSummaries();
    }, 1500);

    return () => window.clearInterval(interval);
  }, [currentBatch, currentBatchId, loadBatchDetail, refreshBatchSummaries]);

  useEffect(() => {
    if (!historyBatchId || !historyBatch) {
      return;
    }

    if (!isBatchActive(historyBatch) || historyBatchId === currentBatchId) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadBatchDetail(historyBatchId, "history");
      void refreshBatchSummaries();
    }, 1500);

    return () => window.clearInterval(interval);
  }, [
    currentBatchId,
    historyBatch,
    historyBatchId,
    loadBatchDetail,
    refreshBatchSummaries,
  ]);

  useEffect(() => {
    if (currentBatchId !== null && currentBatchId === historyBatchId && currentBatch) {
      setHistoryBatch(currentBatch);
    }
  }, [currentBatch, currentBatchId, historyBatchId]);

  const submitRun = async () => {
    setSubmittingRun(true);
    setError(null);

    try {
      const payload = await requestJson<{ batchId: number }>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problemIds: selectedProblemIds,
          modelId: selectedModelId,
          reasoningMode: supportsReasoning ? reasoningMode : "default",
          cheatsheetId: selectedCheatsheetId,
        }),
      });

      setCurrentBatchId(payload.batchId);
      setHistoryBatchId(payload.batchId);
      setTab("run");
      await Promise.all([loadBatchDetail(payload.batchId, "current"), loadInitialData()]);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to start run.");
    } finally {
      setSubmittingRun(false);
    }
  };

  const saveCheatsheet = async (nextDraft: CheatsheetDraft) => {
    if (isCheatsheetContentTooLarge(nextDraft.content)) {
      setError(CHEATSHEET_SIZE_ERROR);
      return;
    }

    setSavingCheatsheet(true);
    setError(null);

    try {
      if (nextDraft.id) {
        const payload = await requestJson<{ cheatsheet: CheatsheetRecord }>(
          `/api/cheatsheets/${nextDraft.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: nextDraft.name,
              content: nextDraft.content,
            }),
          },
        );

        setCheatsheets((existing) =>
          existing.map((entry) =>
            entry.id === payload.cheatsheet.id ? payload.cheatsheet : entry,
          ),
        );
        setSelectedCheatsheetId(payload.cheatsheet.id);
      } else {
        const payload = await requestJson<{ cheatsheet: CheatsheetRecord }>(
          "/api/cheatsheets",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: nextDraft.name,
              content: nextDraft.content,
            }),
          },
        );

        setCheatsheets((existing) => [payload.cheatsheet, ...existing]);
        setSelectedCheatsheetId(payload.cheatsheet.id);
      }

      setDraft(null);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save cheatsheet.",
      );
    } finally {
      setSavingCheatsheet(false);
    }
  };

  const removeCheatsheet = async () => {
    if (!selectedCheatsheetId) {
      return;
    }

    const confirmed = window.confirm(
      "Delete the selected cheatsheet? Existing run history will keep the rendered prompt.",
    );

    if (!confirmed) {
      return;
    }

    try {
      await requestJson<unknown>(`/api/cheatsheets/${selectedCheatsheetId}`, {
        method: "DELETE",
      });
      setCheatsheets((existing) =>
        existing.filter((entry) => entry.id !== selectedCheatsheetId),
      );
      setSelectedCheatsheetId(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete cheatsheet.",
      );
    }
  };

  const stopBatch = async (batchId: number) => {
    setStoppingBatchId(batchId);
    setError(null);

    try {
      const payload = await requestJson<{ batch: RunBatchDetail }>(`/api/runs/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });

      setBatches((existing) =>
        existing.map((entry) => (entry.id === payload.batch.id ? payload.batch : entry)),
      );

      if (currentBatchId === payload.batch.id) {
        setCurrentBatch(payload.batch);
      }

      if (historyBatchId === payload.batch.id) {
        setHistoryBatch(payload.batch);
      }
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "Failed to stop run.");
    } finally {
      setStoppingBatchId((current) => (current === batchId ? null : current));
    }
  };

  const toggleProblem = (problemId: number) => {
    setSelectedProblemIds((existing) =>
      existing.includes(problemId)
        ? existing.filter((entry) => entry !== problemId)
        : [...existing, problemId],
    );
  };

  const selectVisibleProblems = () => {
    setSelectedProblemIds((existing) => {
      const merged = new Set(existing);
      for (const problem of visibleProblems) {
        merged.add(problem.id);
      }
      return Array.from(merged);
    });
  };

  const clearVisibleProblems = () => {
    const visibleIds = new Set(visibleProblems.map((problem) => problem.id));
    setSelectedProblemIds((existing) =>
      existing.filter((problemId) => !visibleIds.has(problemId)),
    );
  };

  const runSummary = currentBatch
    ? {
        completed: currentBatch.items.length,
        accuracy:
          currentBatch.items.length > 0
            ? currentBatch.items.filter((item) => item.isCorrect).length /
              currentBatch.items.length
            : null,
      }
    : null;

  return (
    <main className="app-shell">
      <div className="app-shell__glow app-shell__glow--one" />
      <div className="app-shell__glow app-shell__glow--two" />

      <section className="frame">
        <header className="topbar">
          <div className="topbar__brand">
            <span className="topbar__kicker">SAIR</span>
            <h1>Equation implication bench</h1>
          </div>

          <nav className="topbar__tabs" aria-label="Primary">
            <button
              className={tab === "run" ? "tab-button is-active" : "tab-button"}
              onClick={() => setTab("run")}
            >
              Run
            </button>
            <button
              className={tab === "history" ? "tab-button is-active" : "tab-button"}
              onClick={() => setTab("history")}
            >
              History
            </button>
          </nav>
        </header>

        {error ? <div className="banner banner--error">{error}</div> : null}
        {loading ? <div className="banner">Loading dataset, cheatsheets, and runs...</div> : null}

        <div className="layout">
          <aside className="sidebar">
            {tab === "run" ? (
              <>
                <section className="panel panel--sidebar">
                  <div className="section-heading">
                    <span>Cheatsheet</span>
                    <div className="inline-actions">
                      <button
                        className="ghost-button"
                        onClick={() =>
                          setDraft({
                            name: "",
                            content: "",
                          })
                        }
                      >
                        New
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!selectedCheatsheet}
                        onClick={() =>
                          selectedCheatsheet
                            ? setDraft({
                                id: selectedCheatsheet.id,
                                name: selectedCheatsheet.name,
                                content: selectedCheatsheet.content,
                              })
                            : undefined
                        }
                      >
                        Edit
                      </button>
                    </div>
                  </div>

                  <select
                    className="field"
                    value={selectedCheatsheetId ?? ""}
                    onChange={(event) =>
                      setSelectedCheatsheetId(
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                  >
                    <option value="">None (no cheatsheet)</option>
                    {cheatsheets.map((cheatsheet) => (
                      <option key={cheatsheet.id} value={cheatsheet.id}>
                        {cheatsheet.name}
                      </option>
                    ))}
                  </select>

                  <button
                    className="danger-link"
                    disabled={!selectedCheatsheet}
                    onClick={removeCheatsheet}
                  >
                    Delete selected cheatsheet
                  </button>
                </section>

                <section className="panel panel--sidebar">
                  <div className="section-heading">
                    <span>Model</span>
                  </div>

                  <select
                    className="field"
                    value={selectedModelId}
                    onChange={(event) => setSelectedModelId(event.target.value)}
                  >
                    {SUPPORTED_MODELS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.provider}: {model.label}
                      </option>
                    ))}
                  </select>

                  <div className="reasoning-control">
                    <div className="section-subtitle">
                      Reasoning
                      {!supportsReasoning ? " (not available for this model)" : ""}
                    </div>
                    <div className="segmented">
                      <button
                        className={
                          reasoningMode === "default"
                            ? "segmented__item is-active"
                            : "segmented__item"
                        }
                        onClick={() => setReasoningMode("default")}
                      >
                        Default
                      </button>
                      <button
                        className={
                          reasoningMode === "low"
                            ? "segmented__item is-active"
                            : "segmented__item"
                        }
                        onClick={() => setReasoningMode("low")}
                        disabled={!supportsReasoning}
                      >
                        Low
                      </button>
                    </div>
                  </div>
                </section>

                <section className="panel panel--sidebar panel--grow">
                  <div className="section-heading">
                    <span>Problems</span>
                    <span className="section-meta">
                      {visibleSelectedCount}/{visibleProblems.length}
                    </span>
                  </div>

                  <input
                    className="field"
                    placeholder='Quick search (e.g. "hard_0001" or equation text)'
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />

                  <div className="dataset-tabs">
                    <button
                      className={
                        selectedDifficulty === "normal"
                          ? "dataset-tabs__item is-active"
                          : "dataset-tabs__item"
                      }
                      onClick={() => setSelectedDifficulty("normal")}
                    >
                      normal
                    </button>
                    <button
                      className={
                        selectedDifficulty === "hard"
                          ? "dataset-tabs__item is-active"
                          : "dataset-tabs__item"
                      }
                      onClick={() => setSelectedDifficulty("hard")}
                    >
                      hard
                    </button>
                  </div>

                  <div className="list-toolbar">
                    <button className="ghost-button" onClick={selectVisibleProblems}>
                      Select visible
                    </button>
                    <button className="ghost-button" onClick={clearVisibleProblems}>
                      Clear visible
                    </button>
                  </div>

                  <div className="problem-list">
                    {visibleProblems.map((problem) => {
                      const checked = selectedProblemIds.includes(problem.id);
                      return (
                        <label key={problem.id} className="problem-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleProblem(problem.id)}
                          />
                          <div>
                            <strong>{problem.datasetId}</strong>
                            <p>
                              {problem.equation1} =&gt; {problem.equation2}
                            </p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </section>

                <button
                  className="run-button"
                  disabled={selectedCount === 0 || submittingRun}
                  onClick={submitRun}
                >
                  {submittingRun
                    ? "Launching..."
                    : `Run ${selectedCount} problem${selectedCount === 1 ? "" : "s"}`}
                </button>
              </>
            ) : (
              <section className="panel panel--history-list panel--grow">
                <div className="filters">
                  <select
                    className="field"
                    value={historyDifficultyFilter}
                    onChange={(event) =>
                      setHistoryDifficultyFilter(
                        event.target.value as "all" | Difficulty,
                      )
                    }
                  >
                    <option value="all">All difficulties</option>
                    <option value="normal">Normal only</option>
                    <option value="hard">Hard only</option>
                  </select>

                  <select
                    className="field"
                    value={historyModelFilter}
                    onChange={(event) => setHistoryModelFilter(event.target.value)}
                  >
                    <option value="all">All models</option>
                    {SUPPORTED_MODELS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>

                  <select
                    className="field"
                    value={historyCorrectnessFilter}
                    onChange={(event) =>
                      setHistoryCorrectnessFilter(
                        event.target.value as
                          | "all"
                          | "perfect"
                          | "partial"
                          | "failed",
                      )
                    }
                  >
                    <option value="all">All outcomes</option>
                    <option value="perfect">Perfect</option>
                    <option value="partial">Partial</option>
                    <option value="failed">Failed / zero hit</option>
                  </select>

                  <input
                    className="field"
                    type="date"
                    value={historyDateFilter}
                    onChange={(event) => setHistoryDateFilter(event.target.value)}
                  />
                </div>

                <div className="history-list">
                  {historyBatches.map((batch) => (
                    <button
                      key={batch.id}
                      className={
                        historyBatchId === batch.id
                          ? "history-row is-active"
                          : "history-row"
                      }
                      onClick={() => setHistoryBatchId(batch.id)}
                    >
                      <div>
                        <p className="eyebrow">{formatDateTime(batch.startedAt)}</p>
                        <h3>{batch.modelLabel}</h3>
                      </div>
                      <div className="history-row__meta">
                        <span>{formatPercent(batch.accuracy)}</span>
                        <span
                          className={`status-pill status-pill--${getBatchStatusTone(batch)}`}
                        >
                          {getBatchStatusLabel(batch)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>

          <section className="workspace">
            {tab === "run" ? (
              <>
                <div className="stats-grid">
                  <StatsCard label="Normal bank" value={`${problems.filter((entry) => entry.difficulty === "normal").length}`} />
                  <StatsCard label="Hard bank" value={`${problems.filter((entry) => entry.difficulty === "hard").length}`} />
                  <StatsCard label="Cheatsheets" value={`${cheatsheets.length}`} />
                  <StatsCard label="Selected" value={`${selectedCount}`} accent="focus" />
                  <StatsCard
                    label="Current accuracy"
                    value={formatPercent(runSummary?.accuracy ?? null)}
                    accent="good"
                  />
                </div>

                {!currentBatch ? (
                  <div className="panel panel--main">
                    <EmptyState
                      title="Choose a model, a cheatsheet, and a set of problems."
                      body="The app will render the fixed system prompt, call OpenRouter on the server, score the verdict against the dataset label, and stream progress into this panel through polling."
                    />
                  </div>
                ) : (
                  <div className="run-panel">
                    <div className="panel panel--main">
                      <div className="panel__header">
                        <div>
                          <p className="eyebrow">Current batch</p>
                          <h2>{currentBatch.modelLabel}</h2>
                        </div>
                      <div
                        className={`status-pill status-pill--${getBatchStatusTone(currentBatch)}`}
                      >
                          {getBatchStatusLabel(currentBatch)}
                      </div>
                      </div>

                      <div className="batch-meta">
                        <span>Started {formatDateTime(currentBatch.startedAt)}</span>
                        <span>
                          Cheatsheet: {currentBatch.cheatsheetName ?? "None"}
                        </span>
                        <span>Reasoning: {currentBatch.reasoningMode}</span>
                        <span>
                          {currentBatch.items.length}/{currentBatch.totalCount} completed
                        </span>
                      </div>
                    </div>

                      <div className="result-grid">
                      {currentBatch.items.map((item) => {
                        const responseText = formatStoredResponse({
                          error: item.error,
                          rawResponse: item.rawResponse,
                        });
                        const showReasoningDetails = shouldShowReasoningDetails(
                          currentBatch.modelId,
                          item.rawReasoning,
                        );
                        const reasoningText =
                          item.rawReasoning?.trim() || "Reasoning was not returned for this run.";
                        return (
                          <article key={item.id} className="result-card">
                          <header className="result-card__header">
                            <div>
                              <p className="eyebrow">{item.problem.datasetId}</p>
                              <h3>{currentBatch.modelLabel}</h3>
                            </div>
                            <div
                              className={
                                item.isCorrect
                                  ? "badge badge--success"
                                  : "badge badge--danger"
                              }
                            >
                              {item.isCorrect ? "Correct" : "Incorrect"}
                            </div>
                          </header>

                          <div className="equation-pair">
                            <div>{item.problem.equation1}</div>
                            <div>{item.problem.equation2}</div>
                          </div>

                          <p className="result-card__verdict">
                            Output: {item.parsedVerdict ?? "ERROR"} | Expected:{" "}
                            {item.expectedAnswer ? "TRUE" : "FALSE"}
                          </p>

                          <div className="metrics-row">
                            <StatsCard label="Time" value={formatDuration(item.durationMs)} />
                            <StatsCard
                              label="Cost"
                              value={formatCurrency(item.estimatedCostUsd)}
                            />
                            <StatsCard
                              label="Input"
                              value={`${item.promptTokens ?? "--"}`}
                            />
                            <StatsCard
                              label="Output"
                              value={`${item.completionTokens ?? "--"}`}
                            />
                          </div>

                          {item.reasoningTokens !== null ? (
                            <p className="reasoning-note">
                              Reasoning tokens: {item.reasoningTokens}
                            </p>
                          ) : null}

                          <CopyableDetails
                            summary="Show response"
                            content={responseText}
                          />

                          <details className="details-block">
                            <summary>Show prompt</summary>
                            <pre>{item.renderedPrompt}</pre>
                          </details>

                          {showReasoningDetails ? (
                            <CopyableDetails
                              summary="Show reasoning"
                              content={reasoningText}
                            />
                          ) : null}
                        </article>
                      )})}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <section className="panel panel--history-detail">
                {!historyBatch ? (
                  <EmptyState
                    title="No batch selected."
                    body="Choose a run from the left to inspect prompt, verdict, token, and cost details."
                  />
                ) : (
                  <>
                    <div className="panel__header">
                      <div>
                        <p className="eyebrow">Batch #{historyBatch.id}</p>
                        <h2>{historyBatch.modelLabel}</h2>
                      </div>
                      <div className="panel__header-actions">
                        {(historyBatch.status === "queued" ||
                          historyBatch.status === "running") &&
                        historyBatch.finishedAt === null ? (
                          <button
                            className="ghost-button ghost-button--danger"
                            disabled={
                              stoppingBatchId === historyBatch.id ||
                              historyBatch.stopRequestedAt !== null
                            }
                            onClick={() => stopBatch(historyBatch.id)}
                          >
                            {historyBatch.stopRequestedAt !== null ||
                            stoppingBatchId === historyBatch.id
                              ? "Stopping..."
                              : "Stop evaluation"}
                          </button>
                        ) : null}
                        <div
                          className={`status-pill status-pill--${getBatchStatusTone(historyBatch)}`}
                        >
                          {getBatchStatusLabel(historyBatch)}
                        </div>
                      </div>
                    </div>

                    <div className="batch-meta">
                      <span>Started {formatDateTime(historyBatch.startedAt)}</span>
                      <span>Finished {formatDateTime(historyBatch.finishedAt)}</span>
                      <span>Cheatsheet: {historyBatch.cheatsheetName ?? "None"}</span>
                      <span>Reasoning: {historyBatch.reasoningMode}</span>
                      <span>
                        Score {historyBatch.correctCount}/{historyBatch.completedCount}
                      </span>
                    </div>

                    <div className="result-grid">
                      {historyBatch.items.map((item) => {
                        const responseText = formatStoredResponse({
                          error: item.error,
                          rawResponse: item.rawResponse,
                        });
                        const showReasoningDetails = shouldShowReasoningDetails(
                          historyBatch.modelId,
                          item.rawReasoning,
                        );
                        const reasoningText =
                          item.rawReasoning?.trim() || "Reasoning was not returned for this run.";
                        return (
                          <article key={item.id} className="result-card">
                          <header className="result-card__header">
                            <div>
                              <p className="eyebrow">{item.problem.datasetId}</p>
                              <h3>
                                {item.problem.difficulty} #{item.problem.index}
                              </h3>
                            </div>
                            <div
                              className={
                                item.isCorrect
                                  ? "badge badge--success"
                                  : "badge badge--danger"
                              }
                            >
                              {item.isCorrect ? "Correct" : "Incorrect"}
                            </div>
                          </header>

                          <div className="equation-pair">
                            <div>{item.problem.equation1}</div>
                            <div>{item.problem.equation2}</div>
                          </div>

                          <p className="result-card__verdict">
                            Output: {item.parsedVerdict ?? "ERROR"} | Expected:{" "}
                            {item.expectedAnswer ? "TRUE" : "FALSE"}
                          </p>

                          <div className="metrics-row">
                            <StatsCard label="Time" value={formatDuration(item.durationMs)} />
                            <StatsCard
                              label="Cost"
                              value={formatCurrency(item.estimatedCostUsd)}
                            />
                            <StatsCard
                              label="Input"
                              value={`${item.promptTokens ?? "--"}`}
                            />
                            <StatsCard
                              label="Output"
                              value={`${item.completionTokens ?? "--"}`}
                            />
                          </div>

                          {item.reasoningTokens !== null ? (
                            <p className="reasoning-note">
                              Reasoning tokens: {item.reasoningTokens}
                            </p>
                          ) : null}

                          <CopyableDetails
                            summary="Show response"
                            content={responseText}
                          />

                          <details className="details-block">
                            <summary>Show prompt</summary>
                            <pre>{item.renderedPrompt}</pre>
                          </details>

                          {showReasoningDetails ? (
                            <CopyableDetails
                              summary="Show reasoning"
                              content={reasoningText}
                            />
                          ) : null}
                        </article>
                      )})}
                    </div>
                  </>
                )}
              </section>
            )}
          </section>
        </div>
      </section>

      {draft ? (
        <CheatsheetModal
          initialDraft={draft}
          saving={savingCheatsheet}
          onClose={() => setDraft(null)}
          onSave={saveCheatsheet}
        />
      ) : null}
    </main>
  );
}
