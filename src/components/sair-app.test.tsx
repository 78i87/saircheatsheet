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
    datasetId: "normal_0002",
    index: 2,
    difficulty: "normal",
    equation1: "x * y = z",
    equation2: "z = x * y",
    expectedAnswer: false,
  },
  {
    id: 3,
    datasetId: "normal_0003",
    index: 3,
    difficulty: "normal",
    equation1: "x * (y * z) = w",
    equation2: "w = x * (y * z)",
    expectedAnswer: true,
  },
  {
    id: 4,
    datasetId: "hard_0001",
    index: 1,
    difficulty: "hard",
    equation1: "x = z",
    equation2: "z = x",
    expectedAnswer: false,
  },
  {
    id: 5,
    datasetId: "hard_0002",
    index: 2,
    difficulty: "hard",
    equation1: "(x * y) * z = u",
    equation2: "u = (x * y) * z",
    expectedAnswer: true,
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

  it("auto-selects numeric ranges in the active difficulty", async () => {
    installFetchMock();
    render(<SairApp />);

    await screen.findByText(/choose a model, a cheatsheet, and a set of problems/i);

    const problemSearch = screen.getByPlaceholderText(/quick search or range/i);
    fireEvent.change(problemSearch, { target: { value: "1-2" } });

    expect(screen.getByLabelText(/normal_0001/i)).toBeChecked();
    expect(screen.getByLabelText(/normal_0002/i)).toBeChecked();
    expect(screen.getByLabelText(/normal_0003/i)).not.toBeChecked();
    expect(screen.getByRole("button", { name: /run 2 problems/i })).toBeEnabled();
    expect(screen.getByText(/selecting 2 normal problems from numeric input/i)).toBeInTheDocument();
  });

  it("keeps numeric selections isolated by difficulty", async () => {
    installFetchMock();
    render(<SairApp />);

    await screen.findByText(/choose a model, a cheatsheet, and a set of problems/i);

    const problemSearch = screen.getByPlaceholderText(/quick search or range/i);
    fireEvent.change(problemSearch, { target: { value: "1-2" } });
    expect(screen.getByRole("button", { name: /run 2 problems/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^hard$/i }));
    expect(screen.getByLabelText(/hard_0001/i)).toBeChecked();
    expect(screen.getByLabelText(/hard_0002/i)).toBeChecked();
    expect(screen.getByRole("button", { name: /run 4 problems/i })).toBeEnabled();

    fireEvent.change(problemSearch, { target: { value: "1" } });
    expect(screen.getByLabelText(/hard_0001/i)).toBeChecked();
    expect(screen.getByLabelText(/hard_0002/i)).not.toBeChecked();
    expect(screen.getByRole("button", { name: /run 3 problems/i })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /^normal$/i }));
    expect(screen.getByLabelText(/normal_0001/i)).toBeChecked();
    expect(screen.getByLabelText(/normal_0002/i)).not.toBeChecked();
    expect(screen.getByRole("button", { name: /run 2 problems/i })).toBeEnabled();
  });

  it("keeps plain text search behavior for non-numeric input", async () => {
    installFetchMock();
    render(<SairApp />);

    await screen.findByText(/choose a model, a cheatsheet, and a set of problems/i);

    const problemSearch = screen.getByPlaceholderText(/quick search or range/i);
    fireEvent.change(problemSearch, { target: { value: "normal_0003" } });

    expect(screen.getByLabelText(/normal_0003/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/normal_0001/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/normal_0002/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run 0 problems/i })).toBeDisabled();
  });

  it("shows numeric validation errors without clearing existing selection", async () => {
    installFetchMock();
    render(<SairApp />);

    await screen.findByText(/choose a model, a cheatsheet, and a set of problems/i);

    const problemSearch = screen.getByPlaceholderText(/quick search or range/i);
    fireEvent.change(problemSearch, { target: { value: "1-2" } });
    expect(screen.getByRole("button", { name: /run 2 problems/i })).toBeEnabled();

    fireEvent.change(problemSearch, { target: { value: "1-" } });

    expect(screen.getByText(/use indexes like 1,3,5-8/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/normal_0001/i)).toBeChecked();
    expect(screen.getByLabelText(/normal_0002/i)).toBeChecked();
    expect(screen.getByRole("button", { name: /run 2 problems/i })).toBeEnabled();
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
