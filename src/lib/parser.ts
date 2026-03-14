export type ParsedResponse = {
  verdict: boolean;
  verdictLabel: "TRUE" | "FALSE";
  reasoning: string;
  proof: string;
  counterexample: string;
};

const HEADERS = ["VERDICT:", "REASONING:", "PROOF:", "COUNTEREXAMPLE:"] as const;

export function parseModelResponse(raw: string): ParsedResponse {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const lines = normalized.split("\n");

  const headerIndices = HEADERS.map((header) =>
    lines.findIndex((line) => line.startsWith(header)),
  );

  if (
    headerIndices.some((index) => index === -1) ||
    headerIndices.some((index, position) =>
      position === 0 ? false : index <= headerIndices[position - 1],
    ) ||
    headerIndices[0] !== 0
  ) {
    throw new Error("Response does not follow the required header format.");
  }

  const sections = HEADERS.map((header, position) => {
    const startLine = headerIndices[position];
    const endLine =
      position === HEADERS.length - 1 ? lines.length : headerIndices[position + 1];
    const segment = lines.slice(startLine, endLine);
    const [firstLine, ...rest] = segment;
    const firstLineContent = firstLine.slice(header.length).trim();
    return [firstLineContent, ...rest].join("\n").trim();
  });

  const [verdictLabel, reasoning, proof, counterexample] = sections;

  if (verdictLabel !== "TRUE" && verdictLabel !== "FALSE") {
    throw new Error("VERDICT must be exactly TRUE or FALSE.");
  }

  if (!reasoning) {
    throw new Error("REASONING must be non-empty.");
  }

  if (verdictLabel === "TRUE") {
    if (!proof) {
      throw new Error("PROOF is required when VERDICT is TRUE.");
    }
    if (counterexample) {
      throw new Error("COUNTEREXAMPLE must be empty when VERDICT is TRUE.");
    }
  }

  if (verdictLabel === "FALSE") {
    if (!counterexample) {
      throw new Error("COUNTEREXAMPLE is required when VERDICT is FALSE.");
    }
    if (proof) {
      throw new Error("PROOF must be empty when VERDICT is FALSE.");
    }
  }

  return {
    verdict: verdictLabel === "TRUE",
    verdictLabel,
    reasoning,
    proof,
    counterexample,
  };
}
