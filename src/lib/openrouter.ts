import { buildReasoningPayload, getModelOption, type ReasoningMode } from "@/lib/models";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number | null;
  } | null;
};

type OpenRouterReasoningDetail = {
  text?: string;
  summary?: string | Array<{ text?: string }>;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning?: string;
      reasoning_details?: OpenRouterReasoningDetail[] | null;
    };
  }>;
  usage?: OpenRouterUsage;
};

type OpenRouterStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning?: string;
      reasoning_details?: OpenRouterReasoningDetail[] | null;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenRouterUsage;
  error?: {
    message?: string;
  };
};

export type PricingSnapshot = {
  prompt: number;
  completion: number;
  reasoning: number | null;
  fetchedAt: string;
  source: "openrouter" | "fallback";
};

export type ModelExecutionResult = {
  content: string;
  reasoning: string | null;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  durationMs: number;
  pricing: PricingSnapshot;
  estimatedCostUsd: number;
};

class EmptyOpenRouterResponseError extends Error {
  constructor() {
    super("OpenRouter returned an empty response.");
    this.name = "EmptyOpenRouterResponseError";
  }
}

function getOpenRouterApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }
  return apiKey;
}

function getHeaders() {
  return {
    Authorization: `Bearer ${getOpenRouterApiKey()}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "SAIR Model Eval",
  };
}

let pricingCache:
  | {
      models: Map<string, PricingSnapshot>;
      expiresAt: number;
    }
  | null = null;

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export async function fetchPricingSnapshot(
  modelId: string,
  signal?: AbortSignal,
): Promise<PricingSnapshot> {
  if (pricingCache && pricingCache.expiresAt > Date.now()) {
    const cached = pricingCache.models.get(modelId);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, {
      headers: getHeaders(),
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`OpenRouter model catalog returned ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{
        id: string;
        pricing?: {
          prompt?: string;
          completion?: string;
          internal_reasoning?: string;
        };
      }>;
    };

    const models = new Map<string, PricingSnapshot>();
    const fetchedAt = new Date().toISOString();

    for (const entry of payload.data ?? []) {
      models.set(entry.id, {
        prompt: Number(entry.pricing?.prompt ?? 0),
        completion: Number(entry.pricing?.completion ?? 0),
        reasoning: entry.pricing?.internal_reasoning
          ? Number(entry.pricing.internal_reasoning)
          : null,
        fetchedAt,
        source: "openrouter",
      });
    }

    pricingCache = {
      models,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    const snapshot = models.get(modelId);
    if (snapshot) {
      return snapshot;
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    // Fall through to the static fallback.
  }

  const fallback = getModelOption(modelId).pricingFallback;
  return {
    prompt: fallback.prompt,
    completion: fallback.completion,
    reasoning: fallback.reasoning ?? null,
    fetchedAt: new Date().toISOString(),
    source: "fallback",
  };
}

function flattenContent(
  content: string | Array<{ type?: string; text?: string }> | undefined,
) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => entry.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

function flattenReasoningDetails(details: OpenRouterReasoningDetail[] | null | undefined) {
  if (!Array.isArray(details)) {
    return "";
  }

  return details
    .flatMap((detail) => {
      if (typeof detail.text === "string" && detail.text.length > 0) {
        return [detail.text];
      }

      if (typeof detail.summary === "string" && detail.summary.length > 0) {
        return [detail.summary];
      }

      if (Array.isArray(detail.summary)) {
        return [detail.summary.map((entry) => entry.text ?? "").join("")];
      }

      return [];
    })
    .join("");
}

function parseSseEventData(rawEvent: string) {
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(":"))
    .flatMap((line) => (line.startsWith("data:") ? [line.slice(5).trimStart()] : []));

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n");
}

async function readStreamingChatCompletion(response: Response) {
  if (!response.body) {
    throw new Error("OpenRouter returned an empty stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let usage: OpenRouterUsage | undefined;

  const processEvent = (rawEvent: string) => {
    const payload = parseSseEventData(rawEvent);
    if (!payload || payload === "[DONE]") {
      return;
    }

    const chunk = JSON.parse(payload) as OpenRouterStreamChunk;
    if (chunk.error?.message) {
      throw new Error(`OpenRouter stream failed: ${chunk.error.message}`);
    }

    const delta = flattenContent(chunk.choices?.[0]?.delta?.content);
    if (delta) {
      content += delta;
    }

    const reasoningDelta = chunk.choices?.[0]?.delta?.reasoning;
    if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
      reasoning += reasoningDelta;
    } else {
      const reasoningDetails = flattenReasoningDetails(
        chunk.choices?.[0]?.delta?.reasoning_details,
      );
      if (reasoningDetails) {
        reasoning += reasoningDetails;
      }
    }

    if (chunk.usage) {
      usage = chunk.usage;
    }

    if (chunk.choices?.[0]?.finish_reason === "error") {
      throw new Error("OpenRouter stream terminated with an error.");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      processEvent(rawEvent);
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    processEvent(buffer);
  }

  if (!content) {
    throw new EmptyOpenRouterResponseError();
  }

  return {
    content,
    reasoning: reasoning.trim() || null,
    usage,
  };
}

async function readJsonChatCompletion(response: Response) {
  const parsed = (await response.json()) as OpenRouterResponse;
  const message = parsed.choices?.[0]?.message;
  const content = flattenContent(message?.content);
  if (!content) {
    throw new EmptyOpenRouterResponseError();
  }

  return {
    content,
    reasoning:
      message?.reasoning?.trim() ||
      flattenReasoningDetails(message?.reasoning_details) ||
      null,
    usage: parsed.usage,
  };
}

async function requestChatCompletion(input: {
  modelId: string;
  reasoningMode: ReasoningMode;
  systemPrompt: string;
  signal?: AbortSignal;
  stream: boolean;
}) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: getHeaders(),
    signal: input.signal,
    body: JSON.stringify({
      model: input.modelId,
      stream: input.stream,
      messages: [
        {
          role: "system",
          content: input.systemPrompt,
        },
      ],
      temperature: 0,
      max_tokens: 4096,
      include_reasoning: false,
      usage: {
        include: true,
      },
      ...buildReasoningPayload(input.modelId, input.reasoningMode),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenRouter request failed with ${response.status}: ${errorBody.slice(0, 400)}`,
    );
  }

  return response.headers.get("content-type")?.includes("text/event-stream")
    ? readStreamingChatCompletion(response)
    : readJsonChatCompletion(response);
}

function estimateCostUsd(
  usage: {
    promptTokens: number;
    completionTokens: number;
    reasoningTokens: number;
  },
  pricing: PricingSnapshot,
) {
  const visibleCompletionTokens = Math.max(
    usage.completionTokens - usage.reasoningTokens,
    0,
  );
  const reasoningRate = pricing.reasoning ?? pricing.completion;

  return (
    usage.promptTokens * pricing.prompt +
    visibleCompletionTokens * pricing.completion +
    usage.reasoningTokens * reasoningRate
  );
}

export async function executeModelRun(input: {
  modelId: string;
  reasoningMode: ReasoningMode;
  systemPrompt: string;
  signal?: AbortSignal;
}) {
  const startedAt = Date.now();
  const pricing = await fetchPricingSnapshot(input.modelId, input.signal);
  let payload;

  try {
    payload = await requestChatCompletion({
      ...input,
      stream: true,
    });
  } catch (error) {
    const shouldRetryWithoutStreaming =
      input.modelId === "openai/gpt-oss-120b" &&
      input.reasoningMode === "default" &&
      error instanceof EmptyOpenRouterResponseError;

    if (!shouldRetryWithoutStreaming) {
      throw error;
    }

    payload = await requestChatCompletion({
      ...input,
      stream: false,
    });
  }

  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;
  const reasoningTokens =
    payload.usage?.completion_tokens_details?.reasoning_tokens ??
    payload.usage?.reasoning_tokens ??
    0;

  return {
    content: payload.content,
    reasoning: payload.reasoning,
    promptTokens,
    completionTokens,
    reasoningTokens,
    durationMs: Date.now() - startedAt,
    pricing,
    estimatedCostUsd: estimateCostUsd(
      { promptTokens, completionTokens, reasoningTokens },
      pricing,
    ),
  } satisfies ModelExecutionResult;
}
