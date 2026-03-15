import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SairApp } from "@/components/sair-app";
import { MAX_CHEATSHEET_BYTES } from "@/lib/cheatsheet";

const problemFixture = [
  {
    id: 1,
    datasetId: "normal_0001",
    index: 1,
    difficulty: "normal",
    equation1: "x = y",
    equation2: "y = x",
    expectedAnswer: true,
  },
  {
    id: 2,
    datasetId: "hard_0001",
    index: 1,
    difficulty: "hard",
    equation1: "x = z",
    equation2: "z = x",
    expectedAnswer: false,
  },
] as const;

const batchSummaryFixture = {
  id: 7,
  modelId: "openai/gpt-oss-120b",
  modelLabel: "GPT OSS 120B",
  reasoningMode: "default",
  cheatsheetId: null,
  cheatsheetName: null,
  status: "completed",
  stopRequestedAt: null,
  startedAt: "2026-03-14T12:00:00.000Z",
  finishedAt: "2026-03-14T12:00:10.000Z",
  totalCount: 1,
  completedCount: 1,
  correctCount: 1,
  accuracy: 1,
  difficulties: ["normal"],
} as const;

const batchDetailFixture = {
  ...batchSummaryFixture,
  items: [
    {
      id: 91,
      problem: problemFixture[0],
      expectedAnswer: true,
      parsedVerdict: "TRUE",
      isCorrect: true,
      rawResponse:
        "VERDICT: TRUE\nREASONING: Symmetry.\nPROOF: Direct.\nCOUNTEREXAMPLE:",
      rawReasoning: "I tested a commutativity pattern and it held.",
      renderedPrompt: "prompt body",
      durationMs: 1200,
      promptTokens: 100,
      completionTokens: 140,
      reasoningTokens: 20,
      estimatedCostUsd: 0.0004,
      error: null,
      status: "completed",
    },
  ],
} as const;

function installFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/problems" && !init?.method) {
      return new Response(JSON.stringify({ problems: problemFixture }));
    }

    if (url === "/api/cheatsheets" && !init?.method) {
      return new Response(JSON.stringify({ cheatsheets: [] }));
    }

    if (url === "/api/runs" && !init?.method) {
      return new Response(JSON.stringify({ batches: [batchSummaryFixture] }));
    }

    if (url === "/api/cheatsheets" && init?.method === "POST") {
      return new Response(
        JSON.stringify({
          cheatsheet: {
            id: 10,
            name: "Lemma pack",
            content: "Useful",
            createdAt: "2026-03-14T12:00:00.000Z",
            updatedAt: "2026-03-14T12:00:00.000Z",
          },
        }),
      );
    }

    if (url === "/api/runs" && init?.method === "POST") {
      return new Response(JSON.stringify({ batchId: 7 }), { status: 201 });
    }

    if (url === "/api/runs/7" && !init?.method) {
      return new Response(JSON.stringify({ batch: batchDetailFixture }));
    }

    throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SairApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
  });

  it("supports core run and history interactions", async () => {
    installFetchMock();
    render(<SairApp />);

    expect(
      await screen.findByText(/choose a model, a cheatsheet, and a set of problems/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/normal_0001/i));
    expect(screen.getByRole("button", { name: /run 1 problem/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    fireEvent.change(screen.getByPlaceholderText(/title/i), {
      target: { value: "Lemma pack" },
    });
    fireEvent.change(screen.getByPlaceholderText(/cheatsheet content/i), {
      target: { value: "Useful" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /lemma pack/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /run 1 problem/i }));

    expect(await screen.findByText(/current batch/i)).toBeInTheDocument();
    expect(await screen.findByText(/output: true \| expected: true/i)).toBeInTheDocument();
    expect(screen.getByText(/show reasoning/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    expect(await screen.findByText(/batch #7/i)).toBeInTheDocument();
    expect(screen.getAllByText(/gpt oss 120b/i)[0]).toBeInTheDocument();
  });

  it("blocks oversized cheatsheets from being saved", async () => {
    const fetchMock = installFetchMock();
    render(<SairApp />);

    await screen.findByText(/choose a model, a cheatsheet, and a set of problems/i);

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    fireEvent.change(screen.getByPlaceholderText(/title/i), {
      target: { value: "Oversized" },
    });
    fireEvent.change(screen.getByPlaceholderText(/cheatsheet content/i), {
      target: { value: "a".repeat(MAX_CHEATSHEET_BYTES + 1) },
    });

    expect(
      screen.getByText(/cheatsheet content must be 10 kb or smaller\./i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled();

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => input === "/api/cheatsheets" && init?.method === "POST",
      ),
    ).toBe(false);
  });

  it("does not close the cheatsheet modal when selection ends on the backdrop", async () => {
    installFetchMock();
    render(<SairApp />);

    const [newButton] = await screen.findAllByRole("button", { name: /new/i });
    fireEvent.click(newButton);

    const textarea = screen.getByPlaceholderText(/cheatsheet content/i);
    const backdrop = screen.getByRole("presentation");

    fireEvent.mouseDown(textarea);
    fireEvent.mouseUp(backdrop);
    fireEvent.click(backdrop);

    expect(screen.getByRole("dialog", { name: /new cheatsheet/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/cheatsheet content/i)).toBeInTheDocument();
  });

  it("allows stopping a running batch from history", async () => {
    const runningBatch = {
      ...batchSummaryFixture,
      status: "running" as const,
      finishedAt: null,
      completedCount: 0,
      correctCount: 0,
      accuracy: null,
    };
    const stoppingBatch = {
      ...runningBatch,
      status: "failed" as const,
      stopRequestedAt: "2026-03-14T12:00:05.000Z",
      finishedAt: "2026-03-14T12:00:05.000Z",
    };
    const runningDetail = {
      ...runningBatch,
      items: [],
    };
    const stoppedDetail = {
      ...stoppingBatch,
      items: [],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/problems" && !init?.method) {
        return new Response(JSON.stringify({ problems: problemFixture }));
      }

      if (url === "/api/cheatsheets" && !init?.method) {
        return new Response(JSON.stringify({ cheatsheets: [] }));
      }

      if (url === "/api/runs" && !init?.method) {
        return new Response(JSON.stringify({ batches: [runningBatch] }));
      }

      if (url === "/api/runs/7" && !init?.method) {
        return new Response(JSON.stringify({ batch: runningDetail }));
      }

      if (url === "/api/runs/7" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ batch: stoppedDetail }));
      }

      throw new Error(`Unexpected fetch: ${url} ${init?.method ?? "GET"}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    render(<SairApp />);

    await screen.findByRole("button", { name: /history/i });

    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    fireEvent.click(await screen.findByRole("button", { name: /stop evaluation/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/^stopped$/i).length).toBeGreaterThan(0);
    });

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => input === "/api/runs/7" && init?.method === "PATCH",
      ),
    ).toBe(true);
  });
});
