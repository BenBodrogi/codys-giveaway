"use client";

import { useEffect, useState, useCallback } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FirebaseUser,
} from "firebase/auth";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import { auth, db } from "../../lib/firebaseClient";

const CREATE = "__create__";

// Firebase ID tokens expire hourly and the client SDK doesn't push
// refreshed tokens into React state on its own — fetch a fresh one right
// before every authenticated call instead of caching it.
async function authHeaders(): Promise<HeadersInit> {
  const token = await auth.currentUser?.getIdToken();
  return { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` };
}

export default function Admin() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  const [giveaways, setGiveaways] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [entrants, setEntrants] = useState<any[]>([]);
  const [prizes, setPrizes] = useState<any[]>([]);
  const [winners, setWinners] = useState<any[]>([]);
  const [raffling, setRaffling] = useState(false);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [winnerCount, setWinnerCount] = useState(1);
  const [prizeInputs, setPrizeInputs] = useState<string[]>([""]);

  const [user_, setUser_] = useState(""); // tiktok handle field (named to avoid clashing with `user` = signed-in admin)
  const [dispName, setDispName] = useState("");
  const [coins, setCoins] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  const loadGiveaways = useCallback(async () => {
    const snap = await getDocs(query(collection(db, "giveaways"), orderBy("createdAt", "desc")));
    setGiveaways(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, []);

  const loadDetail = useCallback(async (gid: string) => {
    const [entSnap, przSnap, winSnap] = await Promise.all([
      getDocs(query(collection(db, "giveaways", gid, "entrants"), orderBy("coins", "desc"))),
      getDocs(query(collection(db, "giveaways", gid, "prizes"), orderBy("place", "asc"))),
      getDocs(query(collection(db, "giveaways", gid, "winners"), orderBy("place", "asc"))),
    ]);
    setEntrants(entSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setPrizes(przSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setWinners(winSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, []);

  useEffect(() => {
    if (user) loadGiveaways();
  }, [user, loadGiveaways]);

  useEffect(() => {
    if (active) {
      loadDetail(active.id);
      const timer = setInterval(() => loadDetail(active.id), 4000);
      return () => clearInterval(timer);
    }
  }, [active, loadDetail]);

  useEffect(() => {
    setPrizeInputs((prev) => {
      const next = [...prev];
      while (next.length < winnerCount) next.push("");
      next.length = winnerCount;
      return next;
    });
  }, [winnerCount]);

  async function signIn() {
    setMsg("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function createGiveaway() {
    setMsg("");
    const prizeRows = prizeInputs.map((p) => ({ prize: p }));
    const res = await fetch("/api/giveaways", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ title, description: desc, prizes: prizeRows }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error); return; }
    setTitle(""); setDesc(""); setWinnerCount(1); setPrizeInputs([""]);
    setShowCreate(false);
    await loadGiveaways();
    setActive(j.giveaway);
  }

  async function addCoins() {
    setMsg("");
    const res = await fetch("/api/coins", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ giveawayId: active.id, tiktokUser: user_, displayName: dispName, coins: Number(coins) }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error); return; }
    setUser_(""); setDispName(""); setCoins("");
  }

  async function removeEntrant(id: string, handle: string) {
    setMsg("");
    if (!confirm(`Remove @${handle} and their coins from this giveaway?\n\nNote: if they're still live and gift again, they'll reappear.`)) return;
    const res = await fetch("/api/entrant", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ giveawayId: active.id, entrantId: id }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error); return; }
    loadDetail(active.id);
  }

  async function raffleAll() {
    setMsg("");
    if (!confirm(
      `Raffle all ${prizes.length} places now?\n\nWinners will be drawn privately — nothing appears on the public site until you reveal them one by one.`
    )) return;
    setRaffling(true);
    const res = await fetch("/api/draw", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ giveawayId: active.id }),
    });
    const j = await res.json();
    setRaffling(false);
    if (!res.ok) { setMsg(j.error); return; }
    setMsg(`All ${j.winners?.length ?? prizes.length} places raffled — use "Display on site" to reveal winners one by one.`);
    loadDetail(active.id);
    loadGiveaways();
  }

  async function revealNext() {
    setMsg("");
    const res = await fetch("/api/reveal", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ giveawayId: active.id }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error); return; }
    setMsg(`Place #${j.winner.place} (@${j.winner.tiktokUser}) is now visible on the public site.`);
    loadDetail(active.id);
  }

  async function resetDraw() {
    setMsg("");
    if (!confirm("Reset ALL drawn winners for this giveaway? Use only before announcing.")) return;
    const res = await fetch("/api/reset", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ giveawayId: active.id }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error); return; }
    setMsg("Draw reset.");
    loadDetail(active.id);
    loadGiveaways();
  }

  async function deleteGiveaway() {
    setMsg("");
    const typed = prompt(
      `This permanently deletes "${active.title}" and ALL its entrants, coins, and winners. This cannot be undone.\n\nType the giveaway title to confirm:`
    );
    if (typed === null) return;
    if (typed.trim() !== active.title) { setMsg("Title didn't match — not deleted."); return; }
    const res = await fetch("/api/delete", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ giveawayId: active.id }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error); return; }
    setMsg(`Deleted "${active.title}".`);
    setActive(null);
    loadGiveaways();
  }

  if (!user) {
    return (
      <Wrap>
        <h1 className="display" style={{ fontSize: 40, textAlign: "center" }}>Admin</h1>
        <Card>
          <Field label="Email" value={email} onChange={setEmail} type="email" />
          <Field label="Password" value={password} onChange={setPassword} type="password" />
          <Btn onClick={signIn}>Sign in</Btn>
          {msg && <Err>{msg}</Err>}
        </Card>
      </Wrap>
    );
  }

  const total = entrants.reduce((s, e) => s + e.coins, 0);
  const wonIds = new Set(winners.map((w) => w.entrantId));
  const allRaffled = prizes.length > 0 && winners.length >= prizes.length;
  const unrevealedWinners = winners.filter((w) => !w.revealed);
  const nextRevealPlace = unrevealedWinners.length > 0
    ? Math.max(...unrevealedWinners.map((w) => w.place))
    : null;
  const allRevealed = allRaffled && unrevealedWinners.length === 0;

  return (
    <Wrap>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="display" style={{ fontSize: 36 }}>Admin</h1>
        <button onClick={() => signOut(auth)}
          style={{ background: "var(--accent-2)", color: "#fff", padding: "8px 16px", borderRadius: 10, fontWeight: 700 }}>
          Sign out
        </button>
      </div>

      {msg && <Err>{msg}</Err>}

      <Card>
        <Label>Giveaway</Label>
        <select
          value={showCreate ? CREATE : active?.id ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CREATE) { setShowCreate(true); }
            else if (v === "") { setShowCreate(false); setActive(null); }
            else { setShowCreate(false); setActive(giveaways.find((g) => g.id === v)); }
          }}
          style={inputStyle}
        >
          <option value="">Select from dropdown…</option>
          {giveaways.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title} ({g.status}) — {g.winnerCount} winner{g.winnerCount > 1 ? "s" : ""}
            </option>
          ))}
          <option value={CREATE}>+ Create new giveaway…</option>
        </select>
        {active && !showCreate && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>
              Listener ID:
            </span>
            <code
              style={{
                flex: 1, minWidth: 0, fontSize: 13, background: "var(--bg)", color: "var(--ink)",
                padding: "6px 10px", borderRadius: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {active.id}
            </code>
            <button
              onClick={() => { navigator.clipboard.writeText(active.id); setMsg("Giveaway ID copied."); }}
              style={{
                background: "var(--accent)", color: "#fff", padding: "6px 12px", borderRadius: 8,
                fontWeight: 700, fontSize: 13, flexShrink: 0,
              }}
            >
              Copy
            </button>
          </div>
        )}
      </Card>

      {showCreate && (
        <Card>
          <Label>New giveaway</Label>
          <Field label="Title" value={title} onChange={setTitle} />
          <Field label="Description (optional)" value={desc} onChange={setDesc} />
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>
            Number of winners
          </div>
          <select value={winnerCount} onChange={(e) => setWinnerCount(Number(e.target.value))} style={inputStyle}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", marginBottom: 6 }}>
            Prize per place {winnerCount > 1 && "(1st = top prize)"}
          </div>
          {prizeInputs.map((val, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ width: 30, textAlign: "center" }}>{["🥇","🥈","🥉"][i] ?? `#${i+1}`}</span>
              <input
                style={{ ...inputStyle, marginBottom: 0 }}
                placeholder={`Prize for place ${i + 1}`}
                value={val}
                onChange={(e) => {
                  const next = [...prizeInputs]; next[i] = e.target.value; setPrizeInputs(next);
                }}
              />
            </div>
          ))}
          <Btn onClick={createGiveaway}>Create giveaway</Btn>
        </Card>
      )}

      {active && !showCreate && (
        <>
          {/* Prize tiers — shows revealed/hidden status */}
          <Card>
            <Label>Prizes</Label>
            <div style={{ display: "grid", gap: 6 }}>
              {prizes.map((p) => {
                const w = winners.find((x) => x.place === p.place);
                return (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", background: "var(--bg)", padding: "8px 14px", borderRadius: 10, fontWeight: 600, color: "var(--ink)" }}>
                    <span>{["🥇","🥈","🥉"][p.place-1] ?? `#${p.place}`} {p.prize}</span>
                    <span style={{ color: w?.revealed ? "var(--accent)" : w ? "var(--surface)" : undefined }}>
                      {w
                        ? w.revealed
                          ? `🏆 @${w.tiktokUser}`
                          : `🎲 drawn (hidden)`
                        : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Manual coin entry */}
          <Card>
            <Label>Add coins manually</Label>
            <p style={{ fontSize: 13, color: "var(--accent)", marginBottom: 10 }}>
              For missed gifts or past lives. Adds to the entrant&apos;s total.
            </p>
            <Field label="TikTok @handle" value={user_} onChange={setUser_} />
            <Field label="Display name (optional)" value={dispName} onChange={setDispName} />
            <Field label="Coins" value={coins} onChange={setCoins} type="number" />
            <Btn onClick={addCoins}>Add coins</Btn>
          </Card>

          {/* Draw + reveal */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Label>Entrants ({entrants.length}) — {total.toLocaleString()} coins</Label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {winners.length > 0 && (
                  <button onClick={resetDraw}
                    style={{ background: "transparent", color: "var(--accent-2)", border: "2px solid var(--surface)", padding: "8px 14px", borderRadius: 10, fontWeight: 700 }}>
                    Reset
                  </button>
                )}
                {!allRaffled && (
                  <button onClick={raffleAll} disabled={total === 0 || raffling}
                    style={{ background: total === 0 || raffling ? "#bbb" : "var(--accent)", color: "#fff", padding: "10px 18px", borderRadius: 10, fontWeight: 800 }}>
                    {raffling ? "Raffling…" : "🎲 Raffle All"}
                  </button>
                )}
                {allRaffled && !allRevealed && nextRevealPlace !== null && (
                  <button onClick={revealNext}
                    style={{ background: "var(--accent-2)", color: "#fff", padding: "10px 18px", borderRadius: 10, fontWeight: 800 }}>
                    👁 Display #{nextRevealPlace} on site
                  </button>
                )}
                {allRevealed && (
                  <button disabled
                    style={{ background: "#bbb", color: "#fff", padding: "10px 18px", borderRadius: 10, fontWeight: 800 }}>
                    All revealed ✓
                  </button>
                )}
              </div>
            </div>

            {allRaffled && !allRevealed && (
              <div style={{ background: "var(--surface)", color: "var(--ink)", borderRadius: 10, padding: "10px 14px", marginBottom: 12, fontSize: 13, fontWeight: 700 }}>
                All places raffled — {unrevealedWinners.length} winner{unrevealedWinners.length > 1 ? "s" : ""} hidden.
                Use "Display on site" to reveal one at a time.
              </div>
            )}

            <div style={{ display: "grid", gap: 8 }}>
              {entrants.map((e) => (
                <div key={e.id} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                  background: "var(--bg)", padding: "10px 14px", borderRadius: 10,
                  fontWeight: 600, color: "var(--ink)",
                  outline: wonIds.has(e.id) ? "3px solid var(--accent)" : "none",
                  opacity: wonIds.has(e.id) ? 0.6 : 1,
                }}>
                  <span style={{ flex: 1, minWidth: 0 }}>@{e.tiktokUser} {wonIds.has(e.id) && "🏆"}</span>
                  <span>{e.coins.toLocaleString()} 🪙</span>
                  {!wonIds.has(e.id) && (
                    <button
                      onClick={() => removeEntrant(e.id, e.tiktokUser)}
                      title="Remove entrant"
                      aria-label={`Remove ${e.tiktokUser}`}
                      style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 16, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}
                    >
                      🗑
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {/* Danger zone */}
          <Card>
            <Label>Danger zone</Label>
            <p style={{ fontSize: 13, color: "var(--accent)", marginBottom: 12 }}>
              Permanently deletes this giveaway and all its entrants, coins,
              and winners. This can&apos;t be undone.
            </p>
            <button onClick={deleteGiveaway}
              style={{ background: "#a33", color: "#fff", padding: "12px 20px", borderRadius: 12, fontWeight: 800, width: "100%", fontSize: 15 }}>
              🗑 Delete giveaway
            </button>
          </Card>
        </>
      )}
    </Wrap>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "11px 14px", borderRadius: 10,
  border: "2px solid var(--surface)", fontFamily: "var(--font-body)",
  fontSize: 15, marginBottom: 12, background: "#fff", color: "var(--ink)",
};
function Wrap({ children }: any) {
  return <main style={{ position: "relative", zIndex: 1, maxWidth: 560, margin: "0 auto", padding: "40px 20px 80px", display: "grid", gap: 18 }}>{children}</main>;
}
function Card({ children }: any) {
  return <div style={{ background: "#fff", borderRadius: "var(--radius)", padding: 22, boxShadow: "var(--shadow)" }}>{children}</div>;
}
function Label({ children }: any) {
  return <div style={{ fontWeight: 800, color: "var(--accent-2)", marginBottom: 10 }}>{children}</div>;
}
function Field({ label, value, onChange, type = "text" }: any) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>{label}</div>
      <input style={inputStyle} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Btn({ children, onClick }: any) {
  return <button onClick={onClick} style={{ background: "var(--accent-2)", color: "#fff", padding: "12px 20px", borderRadius: 12, fontWeight: 800, width: "100%", fontSize: 15 }}>{children}</button>;
}
function Err({ children }: any) {
  return <div style={{ background: "#fde2e2", color: "#a33", padding: "10px 14px", borderRadius: 10, fontWeight: 600, fontSize: 14 }}>{children}</div>;
}
