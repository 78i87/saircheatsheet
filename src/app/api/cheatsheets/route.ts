import { NextResponse } from "next/server";
import { z } from "zod";

import { createCheatsheet, listCheatsheets } from "@/lib/store";

export const runtime = "nodejs";

const cheatsheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string(),
});

export async function GET() {
  const cheatsheets = await listCheatsheets();
  return NextResponse.json({ cheatsheets });
}

export async function POST(request: Request) {
  const payload = cheatsheetSchema.parse(await request.json());
  const cheatsheet = await createCheatsheet(payload);
  return NextResponse.json({ cheatsheet }, { status: 201 });
}
