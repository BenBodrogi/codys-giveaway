import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "../../../lib/auth";
import { adminDb } from "../../../lib/firebaseAdmin";

// Create a giveaway plus its prize tiers (one doc per place), in a single
// atomic batch -- no partial "giveaway with no prizes" state possible.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { title, description, prizes } = await req.json();

  // prizes: [{ prize: "..." }, ...], place is assigned by array position
  if (!title || !Array.isArray(prizes) || prizes.length === 0) {
    return NextResponse.json(
      { error: "title and at least one prize required" },
      { status: 400 }
    );
  }
  if (prizes.some((p) => !p.prize?.trim())) {
    return NextResponse.json({ error: "every place needs a prize" }, { status: 400 });
  }

  const db = adminDb();
  const giveawayRef = db.collection("giveaways").doc();
  const winnerCount = prizes.length;

  try {
    const batch = db.batch();
    batch.set(giveawayRef, {
      title,
      description: description || null,
      winnerCount,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      closesAt: null,
    });
    prizes.forEach((p: { prize: string }, i: number) => {
      const place = i + 1;
      batch.set(giveawayRef.collection("prizes").doc(String(place)), {
        place,
        prize: p.prize.trim(),
      });
    });
    await batch.commit();

    return NextResponse.json({
      giveaway: {
        id: giveawayRef.id,
        title,
        description: description || null,
        winnerCount,
        status: "active",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
