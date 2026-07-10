import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../lib/auth";
import { drawNextPlace } from "../../../lib/draw";

// Raffle ALL remaining places at once (1st drawn first -- biggest gifter
// gets the best shot at the top prize). Winners are set revealed=false by
// default, so nothing appears publicly until the admin explicitly reveals
// them via /api/reveal.
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const { giveawayId } = await req.json();
  if (!giveawayId) {
    return NextResponse.json({ error: "giveawayId required" }, { status: 400 });
  }

  const winners: any[] = [];

  // Draw places one by one until all are filled. drawNextPlace draws the
  // lowest unfilled place# (1 first), which gives the full pool to the
  // 1st place draw -- the fairest allocation.
  while (true) {
    try {
      const winner = await drawNextPlace(giveawayId);
      winners.push(winner);
    } catch (e: any) {
      // "All places already drawn" means we're done -- not an error.
      if (e.message?.toLowerCase().includes("all places already drawn")) break;
      // If we already drew at least one, that's still a partial success.
      if (winners.length > 0) break;
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
  }

  if (winners.length === 0) {
    return NextResponse.json({ error: "All places are already raffled." }, { status: 400 });
  }

  return NextResponse.json({ winners });
}
