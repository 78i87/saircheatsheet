const NUMERIC_PROBLEM_QUERY_PATTERN = /^[\d,\-\s]+$/;

function parseProblemIndex(token: string) {
  if (!/^\d+$/.test(token)) {
    throw new Error(`Invalid problem index "${token}".`);
  }

  const value = Number(token);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Problem indexes must be positive integers: "${token}".`);
  }

  return value;
}

export function isProblemRangeQuery(input: string) {
  const trimmed = input.trim();
  return trimmed.length > 0 && NUMERIC_PROBLEM_QUERY_PATTERN.test(trimmed);
}

export function parseProblemRange(input: string) {
  const seen = new Set<number>();
  const indexes: number[] = [];

  for (const rawToken of input.split(",")) {
    const token = rawToken.trim();
    if (!token) {
      throw new Error("Problem list contains an empty entry.");
    }

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseProblemIndex(rangeMatch[1]);
      const end = parseProblemIndex(rangeMatch[2]);
      if (end < start) {
        throw new Error(`Invalid problem range "${token}".`);
      }

      for (let current = start; current <= end; current += 1) {
        if (seen.has(current)) {
          throw new Error(`Duplicate problem index "${current}".`);
        }
        seen.add(current);
        indexes.push(current);
      }

      continue;
    }

    const value = parseProblemIndex(token);
    if (seen.has(value)) {
      throw new Error(`Duplicate problem index "${value}".`);
    }

    seen.add(value);
    indexes.push(value);
  }

  return indexes;
}
