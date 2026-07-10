import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/auth";
import { resetDraw } from "../../../lib/draw";

// Wipe a giveaway's winners so it can be re-drawn (before announcing).
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { giveawayId } = await req.json();
  if (!giveawayId) {
    return NextResponse.json({ error: "giveawayId required" }, { status: 400 });
  }

  try {
    await resetDraw(giveawayId);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
