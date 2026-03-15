export type ParsedResponse = {
  verdict: boolean;
  verdictLabel: "TRUE" | "FALSE";
};

const VERDICT_PATTERN = /^\s*VERDICT:\s*(TRUE|FALSE)\b/im;

export function parseModelResponse(raw: string): ParsedResponse {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(VERDICT_PATTERN);

  if (!match) {
    throw new Error("Response does not include a valid VERDICT line.");
  }

  const verdictLabel = match[1].toUpperCase() as "TRUE" | "FALSE";

  return {
    verdict: verdictLabel === "TRUE",
    verdictLabel,
  };
}
