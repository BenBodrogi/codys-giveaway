import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// Remove a single entrant (and their coins) from a giveaway.
// Refuses if they've already won a place -- reset the draw first.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { giveawayId, entrantId } = await req.json();
  if (!giveawayId || !entrantId) {
    return NextResponse.json({ error: "giveawayId and entrantId required" }, { status: 400 });
  }

  const db = adminDb();
  const giveawayRef = db.collection("giveaways").doc(giveawayId);

  try {
    // guard: don't delete someone who already won (would un-draw a place)
    const wonSnap = await giveawayRef
      .collection("winners")
      .where("entrantId", "==", entrantId)
      .limit(1)
      .get();
    if (!wonSnap.empty) {
      const place = wonSnap.docs[0].data().place;
      return NextResponse.json(
        { error: `That entrant won place #${place}. Reset the draw before removing them.` },
        { status: 400 }
      );
    }

    await giveawayRef.collection("entrants").doc(entrantId).delete();
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
