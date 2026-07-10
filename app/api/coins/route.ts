import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/auth";
import { recordGiftEvent } from "../../../lib/giftEvents";

// Manual override: add coins to an entrant (creates them if new).
// Records a gift event with source='manual' so it rolls up through the
// exact same recordGiftEvent() transaction listener events use --
// single ingestion path, audited.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { giveawayId, tiktokUser, displayName, coins } = await req.json();

  if (!giveawayId || !tiktokUser || typeof coins !== "number") {
    return NextResponse.json(
      { error: "giveawayId, tiktokUser and numeric coins required" },
      { status: 400 }
    );
  }
  if (coins <= 0) {
    return NextResponse.json({ error: "coins must be positive" }, { status: 400 });
  }

  try {
    await recordGiftEvent({
      giveawayId,
      tiktokUser,
      displayName: displayName || null,
      giftName: "manual entry",
      giftCount: 1,
      coinValue: coins,
      source: "manual",
      eventKey: `manual:${giveawayId}:${tiktokUser}:${Date.now()}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
