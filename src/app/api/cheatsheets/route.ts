import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CHEATSHEET_SIZE_ERROR,
  getCheatsheetContentSizeBytes,
  MAX_CHEATSHEET_BYTES,
} from "@/lib/cheatsheet";
import { createCheatsheet, listCheatsheets } from "@/lib/store";

export const runtime = "nodejs";

const cheatsheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().refine(
    (content) => getCheatsheetContentSizeBytes(content) <= MAX_CHEATSHEET_BYTES,
    { message: CHEATSHEET_SIZE_ERROR },
  ),
});

export async function GET() {
  const cheatsheets = await listCheatsheets();
  return NextResponse.json({ cheatsheets });
}

export async function POST(request: Request) {
  const parsed = cheatsheetSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid cheatsheet payload." },
      { status: 400 },
    );
  }

  const cheatsheet = await createCheatsheet(parsed.data);
  return NextResponse.json({ cheatsheet }, { status: 201 });
}
