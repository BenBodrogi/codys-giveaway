import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// Reveal the next drawn-but-hidden winner on the public site.
// Reveals the highest unrevealed place# first (5 -> 4 -> 3 -> 2 -> 1) so
// the public board builds upward toward the grand prize -- the admin
// controls the reveal pace live on stream.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { giveawayId } = await req.json();
  if (!giveawayId) {
    return NextResponse.json({ error: "giveawayId required" }, { status: 400 });
  }

  const db = adminDb();
  const giveawayRef = db.collection("giveaways").doc(giveawayId);

  try {
    const nextSnap = await giveawayRef
      .collection("winners")
      .where("revealed", "==", false)
      .orderBy("place", "desc")
      .limit(1)
      .get();

    if (nextSnap.empty) {
      return NextResponse.json({ error: "All winners are already revealed." }, { status: 400 });
    }

    const winnerDoc = nextSnap.docs[0];
    await winnerDoc.ref.update({
      revealed: true,
      revealedAt: FieldValue.serverTimestamp(),
    });

    const data = winnerDoc.data();
    return NextResponse.json({
      winner: {
        place: data.place,
        tiktokUser: data.tiktokUser,
        displayName: data.displayName,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
