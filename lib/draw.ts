import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";

// ============================================================
//  Equal-chance draw — the Firestore equivalent of the Postgres function
//  `draw_next_place()`. Draws the LOWEST unfilled prize place (largest
//  prize first), picking uniformly at random among entrants who have
//  gifted at least one coin and haven't already won. How many coins
//  someone gifted does NOT change their odds -- it only gets them in.
//  Atomic via a single Firestore transaction: all reads (prizes, winners,
//  eligible entrants) happen first, then the winner doc is written and
//  the giveaway is closed out if that was the last place.
// ============================================================

export type DrawResult = {
  place: number;
  prize: string;
  entrantId: string;
  tiktokUser: string;
  displayName: string | null;
  coins: number;
};

export async function drawNextPlace(giveawayId: string): Promise<DrawResult> {
  const db = adminDb();
  const giveawayRef = db.collection("giveaways").doc(giveawayId);

  return db.runTransaction(async (tx) => {
    const prizesSnap = await tx.get(
      giveawayRef.collection("prizes").orderBy("place", "asc")
    );
    const winnersSnap = await tx.get(giveawayRef.collection("winners"));
    const filledPlaces = new Set(
      winnersSnap.docs.map((d) => d.data().place as number)
    );
    const wonEntrantIds = new Set(
      winnersSnap.docs.map((d) => d.data().entrantId as string)
    );

    const nextPrizeDoc = prizesSnap.docs.find(
      (d) => !filledPlaces.has(d.data().place as number)
    );
    if (!nextPrizeDoc) {
      throw new Error(`All places already drawn for giveaway ${giveawayId}`);
    }
    const place = nextPrizeDoc.data().place as number;
    const prize = nextPrizeDoc.data().prize as string;

    const entrantsSnap = await tx.get(
      giveawayRef.collection("entrants").where("coins", ">", 0)
    );
    const eligible = entrantsSnap.docs.filter((d) => !wonEntrantIds.has(d.id));
    if (eligible.length === 0) {
      throw new Error(`No eligible entrants left to draw for giveaway ${giveawayId}`);
    }

    const winnerDoc = eligible[Math.floor(Math.random() * eligible.length)];
    const wd = winnerDoc.data();

    const winnerRef = giveawayRef.collection("winners").doc(String(place));
    tx.set(winnerRef, {
      place,
      entrantId: winnerDoc.id,
      tiktokUser: wd.tiktokUser,
      displayName: wd.displayName ?? null,
      coins: wd.coins,
      revealed: false,
      revealedAt: null,
      drawnAt: FieldValue.serverTimestamp(),
    });

    // if every OTHER place is already filled, this was the last one
    const stillOpen = prizesSnap.docs.some(
      (d) => d.data().place !== place && !filledPlaces.has(d.data().place as number)
    );
    if (!stillOpen) {
      tx.update(giveawayRef, { status: "drawn" });
    }

    return {
      place,
      prize,
      entrantId: winnerDoc.id,
      tiktokUser: wd.tiktokUser as string,
      displayName: (wd.displayName ?? null) as string | null,
      coins: wd.coins as number,
    };
  });
}

// Wipe a giveaway's winners so it can be re-drawn (before announcing).
export async function resetDraw(giveawayId: string): Promise<void> {
  const db = adminDb();
  const giveawayRef = db.collection("giveaways").doc(giveawayId);
  const winnersSnap = await giveawayRef.collection("winners").get();

  const batch = db.batch();
  winnersSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.update(giveawayRef, { status: "active" });
  await batch.commit();
}
