import { NextRequest, NextResponse } from "next/server";

import { listProblems } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const difficulty = searchParams.get("difficulty");
  const search = searchParams.get("search") ?? undefined;

  const problems = await listProblems({
    difficulty:
      difficulty === "normal" || difficulty === "hard" ? difficulty : undefined,
    search,
  });

  return NextResponse.json({ problems });
}
