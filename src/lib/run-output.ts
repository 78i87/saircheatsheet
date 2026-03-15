export function formatStoredResponse(input: {
  error?: string | null;
  rawResponse?: string | null;
}) {
  if (input.error && input.rawResponse) {
    return `Validation error: ${input.error}\n\n${input.rawResponse}`;
  }

  return input.error ?? input.rawResponse ?? "";
}
