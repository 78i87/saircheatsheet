export const MAX_CHEATSHEET_BYTES = 10 * 1024;
export const CHEATSHEET_SIZE_ERROR =
  "Cheatsheet content must be 10 KB or smaller.";

const textEncoder = new TextEncoder();

export function getCheatsheetContentSizeBytes(content: string) {
  return textEncoder.encode(content).length;
}

export function isCheatsheetContentTooLarge(content: string) {
  return getCheatsheetContentSizeBytes(content) > MAX_CHEATSHEET_BYTES;
}
