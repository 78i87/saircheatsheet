import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CHEATSHEET_SIZE_ERROR,
  getCheatsheetContentSizeBytes,
  MAX_CHEATSHEET_BYTES,
} from "@/lib/cheatsheet";
import { deleteCheatsheet, updateCheatsheet } from "@/lib/store";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const cheatsheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().refine(
    (content) => getCheatsheetContentSizeBytes(content) <= MAX_CHEATSHEET_BYTES,
    { message: CHEATSHEET_SIZE_ERROR },
  ),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.parse(await context.params);
  const parsed = cheatsheetSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid cheatsheet payload." },
      { status: 400 },
    );
  }

  const cheatsheet = await updateCheatsheet(params.id, parsed.data);
  return NextResponse.json({ cheatsheet });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.parse(await context.params);
  await deleteCheatsheet(params.id);
  return new NextResponse(null, { status: 204 });
}
