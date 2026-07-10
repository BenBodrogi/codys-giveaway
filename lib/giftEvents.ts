import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "./firebaseAdmin";

// ============================================================
//  Gift event roll-up — the Firestore equivalent of the Postgres
//  trigger `apply_gift_event()`. There's no server-side trigger
//  in Firestore without Cloud Functions (which need the paid Blaze
//  plan), so this transaction is called directly by both writers:
//  the /api/coins route, and the Python listener (which has its own
//  copy of this same logic in firestore_sink.py — keep them in sync).
// ============================================================

function sanitizeHandle(raw: string): string {
  const handle = raw.trim().replace(/^@/, "");
  if (!handle) throw new Error("tiktok handle required");
  if (handle.includes("/")) throw new Error("invalid tiktok handle");
  return handle;
}

export type GiftEventInput = {
  giveawayId: string;
  tiktokUser: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  giftName?: string | null;
  giftCount?: number;
  coinValue: number;
  source: "listener" | "manual";
  eventKey: string;
};

// Records one gift event and rolls its coins up into the entrant doc,
// atomically. event_key is the doc ID for the gift event, so a duplicate
// (retry/replay) is a Firestore ALREADY_EXISTS error, not a silent no-op —
// we catch specifically that and treat it as "already recorded, ignore".
export async function recordGiftEvent(
  input: GiftEventInput
): Promise<{ duplicate: boolean }> {
  const db = adminDb();
  const handle = sanitizeHandle(input.tiktokUser);
  const giveawayRef = db.collection("giveaways").doc(input.giveawayId);
  const eventRef = giveawayRef.collection("giftEvents").doc(input.eventKey);
  const entrantRef = giveawayRef.collection("entrants").doc(handle);

  try {
    await db.runTransaction(async (tx) => {
      const entrantSnap = await tx.get(entrantRef);
      const existing = entrantSnap.exists ? entrantSnap.data()! : null;

      // Fails with ALREADY_EXISTS if this event_key was already recorded —
      // that's our idempotency check.
      tx.create(eventRef, {
        tiktokUser: handle,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        giftName: input.giftName ?? null,
        giftCount: input.giftCount ?? 1,
        coinValue: input.coinValue,
        source: input.source,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(entrantRef, {
        tiktokUser: handle,
        // prefer the incoming value, keep the existing one if this event
        // didn't carry it — mirrors the trigger's coalesce() upsert.
        displayName: input.displayName ?? existing?.displayName ?? null,
        avatarUrl: input.avatarUrl ?? existing?.avatarUrl ?? null,
        coins: (existing?.coins ?? 0) + input.coinValue,
        createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return { duplicate: false };
  } catch (err: any) {
    if (err?.code === 6 /* ALREADY_EXISTS */) {
      return { duplicate: true };
    }
    throw err;
  }
}
