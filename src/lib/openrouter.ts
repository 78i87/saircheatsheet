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

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  usage?: OpenRouterUsage;
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
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  durationMs: number;
  pricing: PricingSnapshot;
  estimatedCostUsd: number;
};

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

export async function fetchPricingSnapshot(modelId: string): Promise<PricingSnapshot> {
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
  } catch {
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
}) {
  const startedAt = Date.now();
  const pricing = await fetchPricingSnapshot(input.modelId);

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      model: input.modelId,
      messages: [
        {
          role: "system",
          content: input.systemPrompt,
        },
      ],
      temperature: 0,
      max_tokens: 4096,
      include_reasoning: false,
      ...buildReasoningPayload(input.modelId, input.reasoningMode),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `OpenRouter request failed with ${response.status}: ${errorBody.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as OpenRouterResponse;
  const content = flattenContent(payload.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  const promptTokens = payload.usage?.prompt_tokens ?? 0;
  const completionTokens = payload.usage?.completion_tokens ?? 0;
  const reasoningTokens =
    payload.usage?.completion_tokens_details?.reasoning_tokens ??
    payload.usage?.reasoning_tokens ??
    0;

  return {
    content,
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
