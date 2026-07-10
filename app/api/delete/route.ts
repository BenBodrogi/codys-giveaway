import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// Permanently delete a giveaway and everything under it (prizes,
// entrants, winners, gift events). Irreversible -- the UI requires typed
// confirmation before calling this. recursiveDelete() is documented as
// non-atomic (it can fail partway through), but re-running it on the
// same ID is safe -- it just deletes whatever's left, then the doc.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { giveawayId } = await req.json();
  if (!giveawayId) {
    return NextResponse.json({ error: "giveawayId required" }, { status: 400 });
  }

  const db = adminDb();
  try {
    await db.recursiveDelete(db.collection("giveaways").doc(giveawayId));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
