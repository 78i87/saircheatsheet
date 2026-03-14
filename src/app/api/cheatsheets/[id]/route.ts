import { NextResponse } from "next/server";
import { z } from "zod";

import { deleteCheatsheet, updateCheatsheet } from "@/lib/store";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const cheatsheetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.parse(await context.params);
  const payload = cheatsheetSchema.parse(await request.json());
  const cheatsheet = await updateCheatsheet(params.id, payload);
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
