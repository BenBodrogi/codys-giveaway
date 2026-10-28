"use client";

import { useEffect, useState, useCallback } from "react";
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { db } from "../lib/firebaseClient";
import { Avatar } from "../components/Avatar";

type Lang = "en" | "hu";

const T = {
  en: {
    fallbackTitle: "Feeding Frenzy",
    win: "Catch",
    loading: "Waking the water…",
    noGiveaway: "The shark's asleep - no giveaway running right now. Check back soon! 💙",
    winner: "Caught!",
    winners: "Caught!",
    prizesHeading: "The bait",
    andMorePrizes: (n: number) => `(+${n} more catch${n > 1 ? "es" : ""})`,
    poolLabel: "🪙 Gold eaten by the shark",
    noCoins: "The water's empty, be the first fish in! 🫧",
    footer: "Live feed, updates as the shark eats the gold from TikTok 🦈",
    restOfSchool: "The rest of the school",
  },
  hu: {
    fallbackTitle: "Etetési Őrület",
    win: "Zsákmány",
    loading: "Ébredezik a víz…",
    noGiveaway: "A cápa alszik - most nincs futó nyereményjáték. Nézz vissza hamarosan! 💙",
    winner: "Elkapva!",
    winners: "Elkapva!",
    prizesHeading: "A csali",
    andMorePrizes: (n: number) => `(+${n} további zsákmány)`,
    poolLabel: "🪙 Aranyat evett a cápa",
    noCoins: "Üres a víz, legyél te az első hal! 🫧",
    footer: "Élőben frissül, amint a cápa megeszi az aranyat TikTokon 🦈",
    restOfSchool: "A raj többi tagja",
  },
} as const;

type Giveaway = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  winnerCount: number;
};

type Prize = { id: string; place: number; prize: string };
type Winner = {
  place: number;
  entrantId: string;
  tiktokUser: string;
  displayName: string | null;
};

type Entrant = {
  id: string;
  tiktokUser: string;
  displayName: string | null;
  avatarUrl: string | null;
  coins: number;
};

// Deterministic pseudo-random (seeded, not Math.random()) so generated
// shapes are stable across re-renders instead of visibly jittering
// every 4s poll. Still used by the winners-banner ToothStrip below; the
// pool counter's mouth itself is now a designed asset (see SharkMouth)
// rather than procedurally generated -- a hand-illustrated shape reads
// correctly as a shark's mouth in a way a formula-driven one didn't,
// across several attempts.
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// A straight row of procedurally-generated irregular teeth -- used as a
// header divider on cards like the winners banner, so they still carry
// a tooth motif without forcing variable-height content into a fixed
// shape the way the designed mouth asset would.
function toothStripPolys(width: number, count: number, seedBase: number): string[] {
  const polys: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const jitterX = (seededRandom(seedBase + i) - 0.5) * (width / count) * 0.4;
    const x = t * width + jitterX;
    const edgeFactor = Math.max(0.35, Math.sin(t * Math.PI));
    const w = (7 + seededRandom(seedBase + i + 0.3) * 5) * edgeFactor;
    const len = (11 + seededRandom(seedBase + i + 0.6) * 9) * edgeFactor;
    polys.push(`${(x - w / 2).toFixed(1)},0 ${(x + w / 2).toFixed(1)},0 ${x.toFixed(1)},${len.toFixed(1)}`);
  }
  return polys;
}
const TOOTH_STRIP_W = 700;
const TOOTH_STRIP_H = 22;
const TOOTH_STRIP = toothStripPolys(TOOTH_STRIP_W, 18, 41);

function ToothStrip({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox={`0 0 ${TOOTH_STRIP_W} ${TOOTH_STRIP_H}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: TOOTH_STRIP_H, display: "block", transform: flip ? "scaleY(-1)" : undefined }}
      aria-hidden="true"
    >
      {TOOTH_STRIP.map((p, i) => (
        <polygon key={i} points={p} fill="#fff" />
      ))}
    </svg>
  );
}

// Simple placeholder fish silhouette for the winners list -- gold,
// silver, bronze for the top 3, ocean blue for the rest. Standalone and
// easy to swap for a designed asset later, same as the mouth.
function fishColor(place: number): string {
  if (place === 1) return "#E8B923";
  if (place === 2) return "#B9C2CC";
  if (place === 3) return "#B8732E";
  return "var(--accent)";
}
// `color` overrides the place-based rank color -- used by the ambient
// background fish, which aren't winners and shouldn't borrow medal
// colors that would misleadingly suggest rank.
function FishIcon({ place, size = 30, color }: { place: number; size?: number; color?: string }) {
  const c = color ?? fishColor(place);
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 40 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 12 L0 4 L3 12 L0 20 Z" fill={c} />
      <ellipse cx="24" cy="12" rx="16" ry="9" fill={c} />
      <circle cx="36" cy="10" r="1.7" fill="#0B1D33" />
    </svg>
  );
}

// document.documentElement.clientWidth (unlike the CSS unit 100vw)
// excludes the vertical scrollbar's own width -- used instead of 100vw
// below so the full-bleed fish/bubble layers measure the TRUE visible
// width exactly, rather than overshooting it by the scrollbar's width
// (100vw is spec'd to include it) and relying on overflow:hidden to
// paper over the gap. Returns null on the very first render (before
// the effect runs) so callers can skip rendering until a real
// measurement exists, avoiding an SSR/hydration mismatch.
//
// Re-measures via ResizeObserver on <html> itself, not just a window
// "resize" listener -- a scrollbar can appear/disappear purely from
// PAGE CONTENT growing/shrinking taller (giveaway data loading in
// async, winners being revealed, entrant count changing on the 4s
// poll), which changes clientWidth without the window itself ever
// resizing, so a resize-only listener would leave a stale measurement
// locked in from whatever the very first render happened to look like.
function useViewportWidth(): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setWidth(document.documentElement.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);
  return width;
}

// Ambient background fish -- same decorative treatment as the bubbles
// (behind content, non-interactive, aria-hidden), but each one both
// drifts slowly across the screen AND bobs/tilts on a much shorter,
// faster cycle layered on top, so the motion reads as swimming rather
// than just gliding in a straight line. Three nested layers per fish:
// outer handles the slow horizontal crossing, a middle static wrapper
// flips fish swimming right-to-left so they face their direction of
// travel (the icon is drawn facing right), and the inner wrapper does
// the fast bob+tilt independently of the flip.
// Same medal colors as fishColor() (used for winner rows) -- reused
// here so the three rare fish read as "bronze/silver/gold" in the same
// visual language as the rest of the site, not arbitrary new colors.
const FISH_WHITE = "#ffffff";
const FISH_BRONZE = "#B8732E";
const FISH_SILVER = "#B9C2CC";
const FISH_GOLD = "#E8B923";

// 17 plain + 1 of each medal color = 20. The three medal fish each get
// a longer duration/bigger delay offset and a bit more opacity than the
// plain ones (same treatment gold already had) so they read as a rarer
// spot when one does drift by, rather than blending into the school.
const SWIM_FISH = [
  { size: 30, topPct: 3,  duration: 33, delay: 2,  dir: 1 as const,  bobDuration: 2.4, opacity: 0.28, color: FISH_WHITE },
  { size: 22, topPct: 8,  duration: 26, delay: 11, dir: -1 as const, bobDuration: 2.0, opacity: 0.24, color: FISH_WHITE },
  { size: 28, topPct: 13, duration: 38, delay: 5,  dir: 1 as const,  bobDuration: 2.8, opacity: 0.3,  color: FISH_WHITE },
  { size: 24, topPct: 18, duration: 22, delay: 16, dir: -1 as const, bobDuration: 2.1, opacity: 0.32, color: FISH_SILVER },
  { size: 26, topPct: 23, duration: 30, delay: 8,  dir: 1 as const,  bobDuration: 2.5, opacity: 0.28, color: FISH_WHITE },
  { size: 24, topPct: 28, duration: 35, delay: 1,  dir: -1 as const, bobDuration: 2.2, opacity: 0.24, color: FISH_WHITE },
  { size: 32, topPct: 33, duration: 24, delay: 13, dir: 1 as const,  bobDuration: 2.6, opacity: 0.3,  color: FISH_WHITE },
  { size: 21, topPct: 38, duration: 29, delay: 19, dir: -1 as const, bobDuration: 1.9, opacity: 0.22, color: FISH_WHITE },
  { size: 27, topPct: 43, duration: 37, delay: 6,  dir: 1 as const,  bobDuration: 2.7, opacity: 0.28, color: FISH_WHITE },
  { size: 23, topPct: 48, duration: 21, delay: 14, dir: -1 as const, bobDuration: 2.0, opacity: 0.3,  color: FISH_BRONZE },
  { size: 29, topPct: 53, duration: 32, delay: 3,  dir: 1 as const,  bobDuration: 2.5, opacity: 0.28, color: FISH_WHITE },
  { size: 25, topPct: 58, duration: 27, delay: 17, dir: -1 as const, bobDuration: 2.1, opacity: 0.24, color: FISH_WHITE },
  { size: 31, topPct: 63, duration: 40, delay: 9,  dir: 1 as const,  bobDuration: 2.9, opacity: 0.3,  color: FISH_WHITE },
  { size: 22, topPct: 68, duration: 23, delay: 4,  dir: -1 as const, bobDuration: 2.0, opacity: 0.22, color: FISH_WHITE },
  { size: 28, topPct: 73, duration: 34, delay: 12, dir: 1 as const,  bobDuration: 2.6, opacity: 0.28, color: FISH_WHITE },
  { size: 24, topPct: 78, duration: 28, delay: 18, dir: -1 as const, bobDuration: 2.1, opacity: 0.24, color: FISH_WHITE },
  { size: 26, topPct: 83, duration: 31, delay: 7,  dir: 1 as const,  bobDuration: 2.4, opacity: 0.26, color: FISH_WHITE },
  { size: 20, topPct: 88, duration: 25, delay: 15, dir: -1 as const, bobDuration: 1.9, opacity: 0.22, color: FISH_WHITE },
  { size: 27, topPct: 93, duration: 36, delay: 10, dir: 1 as const,  bobDuration: 2.7, opacity: 0.28, color: FISH_WHITE },
  // The rare one -- its own long, offset cycle means it only drifts by
  // now and then rather than being constantly on screen.
  { size: 28, topPct: 97, duration: 27, delay: 20, dir: 1 as const,  bobDuration: 2.7, opacity: 0.36, color: FISH_GOLD },
];

// Wrapping fish in their own overflow:hidden layer (rather than setting
// overflow on <main> itself) clips their -12%/112% enter/exit overshoot
// so it can never push the page's scrollable width past the real
// window edge, at any viewport size -- without touching <main>'s own
// overflow, which stays visible so Bubbles can still rise above main's
// top edge into the wave band unclipped.
// zIndex is negative -- fish paint BEHIND main's other children (pure
// background decoration, not meant to visibly overlap the mouth,
// winners banner, or leaderboard cards). This does mean a fish is
// invisible for however long it's passing behind a wide, opaque card,
// same as before the zIndex was ever raised -- a deliberate tradeoff:
// overlapping the actual UI looked worse than the gaps do.
// left:50%/width:<viewport>/translateX(-50%) is the standard "full
// bleed" trick to break out of <main>'s own narrower, centered
// maxWidth:720 column and span the TRUE viewport edge-to-edge --
// inset:0 alone would only span main's own (possibly much narrower, on
// a wide screen) box, which is what previously kept fish confined
// between roughly main's left/right edges instead of the actual screen
// edges. Width comes from useViewportWidth() (document.documentElement
// .clientWidth) rather than the CSS unit 100vw, which is spec'd to
// include the scrollbar's own width and so slightly overshoots the
// actually-visible area on non-overlay-scrollbar browsers. top/bottom
// stay tied to main's own height so vertical placement (and scrolling
// with the page) is unaffected, only the horizontal span changes.
function SwimmingFish() {
  const vw = useViewportWidth();
  if (vw === null) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "50%",
        width: vw,
        transform: "translateX(-50%)",
        overflow: "hidden",
        pointerEvents: "none",
        zIndex: -1,
      }}
    >
      {SWIM_FISH.map((f, i) => (
        <div
          key={i}
          className="fish-swim"
          style={{
            position: "absolute",
            top: `${f.topPct}%`,
            left: "10%",
            opacity: f.opacity,
            // Negative delay starts the animation already in progress
            // (as if it had been running for f.delay seconds), instead
            // of a positive delay, which holds the fish still at its
            // static `left` above and then jumps to the keyframe's
            // start the moment the delay elapses -- that jump was
            // reading as the fish randomly vanishing/reappearing rather
            // than swimming continuously end to end.
            animation: `${f.dir === 1 ? "swim-right" : "swim-left"} ${f.duration}s linear -${f.delay}s infinite`,
          }}
        >
          <div style={{ transform: f.dir === -1 ? "scaleX(-1)" : undefined }}>
            <div className="fish-bob" style={{ animation: `fish-bob ${f.bobDuration}s ease-in-out infinite` }}>
              <FishIcon place={0} size={f.size} color={f.color} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Reusable maw frame -- fixed size (the mouth doesn't need to grow;
// the entrant list below already shows momentum), content centered on
// top of the interior + teeth.
// The mouth is the largest, most dominant element on the page --
// deliberately bigger than any other card. Uses the hand-illustrated
// asset at public/shark-mouth.png: real character (eyes, blush, a
// genuine expression) that a formula can't produce, and the teeth read
// correctly as a shark's because they were placed with actual artistic
// judgment rather than generated from a sine wave -- several procedural
// attempts kept reading as "human/dental" no matter how the geometry
// was tuned. The counter content is absolutely positioned into the
// mouth's safe zone, not just centered in the whole image: the asset is
// a full head (forehead + eyes take up roughly the top 40%), and the
// safe zone below was measured directly from the pink inner-mouth
// ellipse in the source artwork's own coordinates rather than guessed --
// verified against the rendered PNG's actual box (not just the original
// SVG export it was measured from), since the two aren't the same pixel
// dimensions.
function SharkMouth({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", width: "100%", maxWidth: 560, margin: "0 auto" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/shark-mouth.png" alt="" style={{ width: "100%", display: "block" }} />
      <div
        style={{
          position: "absolute",
          top: "46%",
          bottom: "22%",
          left: "29%",
          right: "29%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// Waterline divider between the hero ("above water") and the rest of
// the page ("underwater") -- a smooth wave instead of the hard flat cut
// the hero used to end on. Rendered as a CSS background tile at a FIXED
// pixel size (not an SVG stretched with preserveAspectRatio="none" to
// fill an arbitrary container width) -- that's exactly the bug that
// distorted the teeth strip on a wide screen earlier, and stretching a
// wide/shallow shape like this wave non-uniformly is even more visible.
// Cycles is a whole number so the tile repeats with no seam, and
// scrolling background-position by exactly one tile-width loops forever
// for a slow drifting motion. Colors are hardcoded hex (data URIs can't
// reference CSS custom properties) -- must stay in sync with
// --sky-bottom (lagoon) and --sea-glass in globals.css if those change.
function buildWave(width: number, height: number, cycles: number, amplitude: number) {
  const baseline = height - amplitude - 4;
  const steps = 60;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width;
    const y = baseline + Math.sin((i / steps) * cycles * Math.PI * 2) * amplitude;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return {
    fill: `M0,0 L${width},0 L${pts.slice().reverse().join(" L")} Z`,
    crest: `M${pts.join(" L")}`,
  };
}
const WAVE_VB_W = 700;
const WAVE_VB_H = 46;
const WAVE = buildWave(WAVE_VB_W, WAVE_VB_H, 2, 16);
const WAVE_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WAVE_VB_W} ${WAVE_VB_H}">` +
    `<path d="${WAVE.fill}" fill="#1F9EBF"/>` +
    `<path d="${WAVE.crest}" fill="none" stroke="#9FE7E8" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>` +
    `</svg>`
)}`;

function WaveDivider() {
  return (
    <div
      aria-hidden="true"
      className="wave-scroll"
      style={{
        position: "relative",
        zIndex: 1,
        height: WAVE_VB_H,
        backgroundImage: `url("${WAVE_DATA_URI}")`,
        backgroundSize: `${WAVE_VB_W}px ${WAVE_VB_H}px`,
        backgroundRepeat: "repeat-x",
        animation: "wave-scroll 16s linear infinite",
      }}
    />
  );
}

// A field of bubbles for the "underwater" content area -- fixed,
// modest starting positions concentrated near the top so they read well
// even on a short page (empty giveaway, few entrants), pure decoration
// (aria-hidden, pointer-events none). Each one rises from its own spawn
// point up to `surface`, a y position (relative to <main>'s own top
// edge) where it fades out.
//
// `surface` is a shallow, consistent range (-1 to -3.5, main-space) for
// every bubble, not spread across the wave's full crest-to-trough range
// like an earlier version of this tried. The wave's dark fill retreats
// to main-space -4 at its shallowest (the trough) and reaches all the
// way to -36 at its deepest (a crest) -- so a bubble is only GUARANTEED
// transparent everywhere if its surface stays less negative than -4;
// anything at or past -4 fades out inside solid "water" for at least
// part of the wave's cycle, i.e. above the waterline a viewer can
// actually see. Worse, since `left` is now a % of the full viewport
// (see the wrapper below) while the wave tiles at a fixed 700px, which
// local wave height sits under any given bubble isn't even consistent
// across viewport widths. Staying comfortably inside the trough's
// guaranteed-clear -4 boundary (with margin, not right up against it)
// sidesteps needing to solve that per-bubble alignment at all -- and
// bubbles all rising to roughly the same depth instead of a spread of
// different heights is closer to how real bubbles actually behave
// anyway (they all pop at the one real water surface, not at a dozen
// different heights). `left` is spread broadly across the full width
// rather than clustered at the edges, to match SwimmingFish -- see the
// wrapper's zIndex comment below for why.
const BUBBLES = [
  { size: 20, left: "2%",  top: 20,  opacity: 0.5,  delay: 0,   surface: -2.5 },
  { size: 14, left: "12%", top: 70,  opacity: 0.4,  delay: 1.4, surface: -1   },
  { size: 24, left: "22%", top: 130, opacity: 0.3,  delay: 2.8, surface: -3   },
  { size: 11, left: "32%", top: 40,  opacity: 0.45, delay: 4.1, surface: -1.5 },
  { size: 17, left: "42%", top: 190, opacity: 0.35, delay: 0.6, surface: -3.5 },
  { size: 22, left: "52%", top: 90,  opacity: 0.4,  delay: 3.5, surface: -1   },
  { size: 13, left: "62%", top: 160, opacity: 0.45, delay: 5.2, surface: -2.5 },
  { size: 19, left: "72%", top: 60,  opacity: 0.5,  delay: 2.0, surface: -3   },
  { size: 10, left: "82%", top: 240, opacity: 0.4,  delay: 6.1, surface: -1.5 },
  { size: 25, left: "92%", top: 300, opacity: 0.3,  delay: 1.0, surface: -3.5 },
  { size: 15, left: "97%", top: 260, opacity: 0.4,  delay: 4.7, surface: -1   },
  { size: 12, left: "7%",  top: 340, opacity: 0.35, delay: 3.0, surface: -2.5 },
  { size: 21, left: "17%", top: 280, opacity: 0.3,  delay: 5.8, surface: -3   },
  { size: 16, left: "27%", top: 380, opacity: 0.35, delay: 2.4, surface: -1.5 },
  { size: 18, left: "37%", top: 420, opacity: 0.3,  delay: 6.6, surface: -3.5 },
  { size: 13, left: "47%", top: 460, opacity: 0.4,  delay: 0.3, surface: -1   },
  { size: 20, left: "57%", top: 500, opacity: 0.35, delay: 3.9, surface: -2.5 },
  { size: 11, left: "67%", top: 210, opacity: 0.45, delay: 5.0, surface: -3   },
  { size: 23, left: "77%", top: 350, opacity: 0.3,  delay: 1.8, surface: -1.5 },
  { size: 15, left: "87%", top: 440, opacity: 0.4,  delay: 4.4, surface: -3.5 },
  { size: 12, left: "94%", top: 110, opacity: 0.45, delay: 2.6, surface: -1   },
  { size: 19, left: "4%",  top: 480, opacity: 0.35, delay: 6.9, surface: -2.5 },
  { size: 16, left: "48%", top: 320, opacity: 0.3,  delay: 0.9, surface: -3   },
  { size: 14, left: "63%", top: 400, opacity: 0.4,  delay: 3.3, surface: -1.5 },
];

// Wrapper mirrors SwimmingFish's full-bleed trick (see its comment) so
// bubbles' left:% values spread across the true viewport width instead
// of just <main>'s own narrower column -- but deliberately NOT
// overflow:hidden, since bubbles are meant to rise above main's own top
// edge into the wave band (see the surface comment above). zIndex is
// negative, same reasoning as SwimmingFish -- pure background
// decoration, behind main's other content rather than overlapping it.
function Bubbles() {
  const vw = useViewportWidth();
  if (vw === null) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: "50%",
        width: vw,
        transform: "translateX(-50%)",
        pointerEvents: "none",
        zIndex: -1,
      }}
    >
      {BUBBLES.map((b, i) => {
        const dy = b.surface - b.top; // total travel distance up to this bubble's own surface point
        const duration = 5 + (Math.abs(dy) / 550) * 7; // farther to travel = longer, so rise speed reads consistent
        return (
          <div
            key={i}
            className="bubble-rise"
            style={{
              position: "absolute",
              left: b.left,
              top: b.top,
              width: b.size,
              height: b.size,
              borderRadius: "50%",
              background: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.85), rgba(255,255,255,0.15) 60%, transparent 72%)",
              border: "1px solid rgba(255,255,255,0.45)",
              opacity: b.opacity,
              ["--dy" as any]: `${dy}px`,
              ["--o" as any]: b.opacity,
              // Negative delay (see SwimmingFish for the same fix, same
              // reason) so each bubble starts already mid-cycle instead
              // of sitting at its base opacity and jumping to the
              // keyframe's opacity:0 start the moment a positive delay
              // elapses.
              animation: `rise-to-surface ${duration.toFixed(1)}s linear -${b.delay}s infinite`,
            } as React.CSSProperties}
          />
        );
      })}
    </div>
  );
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];
  const [giveaway, setGiveaway] = useState<Giveaway | null>(null);
  const [entrants, setEntrants] = useState<Entrant[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const gwSnap = await getDocs(
      query(collection(db, "giveaways"), orderBy("createdAt", "desc"), limit(1))
    );
    if (gwSnap.empty) {
      setGiveaway(null);
      setLoading(false);
      return;
    }
    const gwDoc = gwSnap.docs[0];
    const gid = gwDoc.id;
    const gw = gwDoc.data();
    setGiveaway({
      id: gid,
      title: gw.title,
      description: gw.description ?? null,
      status: gw.status,
      winnerCount: gw.winnerCount,
    });

    const [entSnap, przSnap, winSnap] = await Promise.all([
      getDocs(query(collection(db, "giveaways", gid, "entrants"), where("coins", ">", 0), orderBy("coins", "desc"))),
      getDocs(query(collection(db, "giveaways", gid, "prizes"), orderBy("place", "asc"))),
      getDocs(query(collection(db, "giveaways", gid, "winners"), where("revealed", "==", true), orderBy("place", "asc"))),
    ]);

    setEntrants(entSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Entrant)));
    setPrizes(przSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Prize)));
    setWinners(winSnap.docs.map((d) => d.data() as Winner));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Live-ish updates via polling — no Firestore onSnapshot listener
    // needed. Re-fetches every 4s; pauses when the tab is hidden to
    // avoid burning reads on backgrounded tabs.
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      timer = setInterval(load, 4000);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { load(); start(); }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const total = entrants.reduce((s, e) => s + e.coins, 0);
  const topPrize = prizes.find((p) => p.place === 1) ?? null;
  const medal = (place: number) => ["🥇", "🥈", "🥉"][place - 1] ?? `#${place}`;

  const podium = [1, 0, 2].map((rankIdx) => entrants[rankIdx] ?? null);
  const rest = entrants.slice(3);

  return (
    <>
      {/* ---- Hero ---- */}
      <header className="hero">
        <div style={{ position: "relative", zIndex: 1, maxWidth: 720, margin: "0 auto", padding: "32px 20px 40px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
            <div
              style={{
                display: "inline-flex",
                background: "#fff",
                borderRadius: 999,
                padding: 4,
                boxShadow: "0 4px 14px -8px rgba(3,8,15,.4)",
                gap: 2,
              }}
            >
              {(["en", "hu"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  style={{
                    background: lang === l ? "var(--accent)" : "transparent",
                    color: lang === l ? "var(--on-color)" : "var(--accent)",
                    borderRadius: 999,
                    padding: "5px 14px",
                    fontWeight: 800,
                    fontSize: 13,
                    transition: "all .15s ease",
                  }}
                >
                  {l === "en" ? "EN" : "HU"}
                </button>
              ))}
            </div>
          </div>
          <h1
            className="display"
            style={{ fontSize: "clamp(40px, 9vw, 72px)", marginTop: 12 }}
          >
            {giveaway?.title ?? t.fallbackTitle}
          </h1>
          {giveaway && topPrize && (
            <p style={{ marginTop: 14, fontSize: 18, color: "var(--on-color)", opacity: 0.95, fontWeight: 600 }}>
              ✨ {t.win}: {topPrize.prize}
              {prizes.length > 1 && ` ${t.andMorePrizes(prizes.length - 1)}`}
            </p>
          )}
        </div>
      </header>

      <WaveDivider />

      <main style={{ position: "relative", zIndex: 1, maxWidth: 720, margin: "0 auto", padding: "36px 20px 80px" }}>
        <Bubbles />
        <SwimmingFish />
        {loading && <Center>{t.loading}</Center>}

        {!loading && !giveaway && (
          <Center>{t.noGiveaway}</Center>
        )}

        {giveaway && (
          <>
            {/* ---- Pool counter, inside a shark's mouth -- the largest,
                 most dominant element on the page ---- */}
            <div style={{ marginBottom: 24 }}>
              <SharkMouth>
                {/* Dark text, not the usual white-on-color -- the new
                    mouth's interior is a light pink, not the old dark
                    maroon, and this color matches the illustration's
                    own line art for a cohesive look. clamp() keeps the
                    number from overflowing the safe zone on narrow
                    screens, where the whole mouth (and so the safe
                    zone) renders smaller. */}
                <div className="display" style={{ fontSize: "clamp(28px, 11vw, 48px)", color: "#2a343d", textShadow: "none", lineHeight: 1 }}>
                  {total.toLocaleString()}
                </div>
                <div style={{ fontSize: "clamp(11px, 3vw, 15px)", fontWeight: 700, color: "#2a343d", marginTop: 6 }}>
                  {t.poolLabel}
                </div>
              </SharkMouth>
            </div>

            {/* ---- Winners (caught!) -- each one pops in as a colored
                 fish, gold/silver/bronze for the top 3 ---- */}
            {winners.length > 0 && (
              <div style={{ borderRadius: "var(--radius)", overflow: "hidden", marginBottom: 28, boxShadow: "var(--shadow)" }}>
                <div style={{ background: "var(--accent-2)" }}>
                  <ToothStrip />
                </div>
                <div style={{ background: "var(--accent-2)", color: "var(--on-color)", padding: "4px 20px" }}>
                  <div style={{ textAlign: "center", fontSize: 22 }}>🎉</div>
                  <div className="display" style={{ fontSize: 24, marginTop: 2, textAlign: "center" }}>
                    {winners.length === 1 ? t.winner : t.winners}
                  </div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {[...winners].sort((a, b) => a.place - b.place).map((w) => {
                      const prize = prizes.find((p) => p.place === w.place);
                      return (
                        <div
                          key={w.place}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            background: "rgba(255,255,255,0.12)",
                            borderRadius: "var(--radius-sm)",
                            padding: "10px 14px",
                            animation: "pop .4s ease",
                          }}
                        >
                          <div style={{ width: 34, display: "flex", justifyContent: "center" }}>
                            <FishIcon place={w.place} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: 18 }}>
                              @{w.tiktokUser}
                            </div>
                            {prize && (
                              <div style={{ fontSize: 14, opacity: 0.9 }}>{prize.prize}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{ background: "var(--accent-2)" }}>
                  <ToothStrip flip />
                </div>
              </div>
            )}

            {giveaway.description && (
              <p
                style={{
                  textAlign: "center",
                  color: "var(--accent-2)",
                  margin: "8px 4px 26px",
                  lineHeight: 1.6,
                }}
              >
                {giveaway.description}
              </p>
            )}

            {/* ---- The bait (multi-prize, before winners drawn) ---- */}
            {prizes.length > 1 && winners.length === 0 && (
              <div style={{ marginBottom: 26 }}>
                <div style={{ textAlign: "center", fontWeight: 800, color: "var(--accent-2)", marginBottom: 12 }}>
                  {t.prizesHeading}
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {prizes.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        background: "#fff",
                        borderRadius: "6px 20px 6px 20px",
                        padding: "12px 16px",
                        boxShadow: "0 4px 14px -8px rgba(3,8,15,.4)",
                      }}
                    >
                      <span style={{ fontSize: 22, width: 34, textAlign: "center" }}>{medal(p.place)}</span>
                      <span style={{ fontWeight: 700, color: "var(--ink)" }}>{p.prize}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Podium: top 3 fish, laid out by rank instead of a
                 uniform stacked list ---- */}
            {entrants.length > 0 && (
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 10, marginBottom: 20 }}>
                {podium.map((e, col) => {
                  const rankIdx = [1, 0, 2][col];
                  if (!e) return <div key={rankIdx} style={{ flex: 1, maxWidth: 160 }} />;
                  const podiumHeight = rankIdx === 0 ? 172 : rankIdx === 1 ? 128 : 102;
                  return (
                    <div key={e.id} style={{ flex: 1, maxWidth: 160, display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <Avatar src={e.avatarUrl} name={e.displayName || e.tiktokUser} size={rankIdx === 0 ? 56 : 44} />
                      <div
                        style={{
                          fontWeight: 700, color: "var(--ink)", fontSize: 12, marginTop: 6,
                          maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                      >
                        {e.displayName || `@${e.tiktokUser}`}
                      </div>
                      <div
                        style={{
                          marginTop: 8, width: "100%", height: podiumHeight,
                          background: rankIdx === 0 ? "var(--accent-2)" : "var(--accent)",
                          borderRadius: "14px 14px 0 0",
                          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start",
                          paddingTop: 12, color: "var(--on-color)", boxShadow: "var(--shadow)",
                        }}
                      >
                        <div style={{ fontSize: rankIdx === 0 ? 26 : 20 }}>{medal(rankIdx + 1)}</div>
                        <div className="display" style={{ fontSize: rankIdx === 0 ? 22 : 17, marginTop: 4 }}>
                          {e.coins.toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---- The rest of the school ---- */}
            {rest.length > 0 && (
              <div style={{ textAlign: "center", fontWeight: 800, color: "var(--accent-2)", marginBottom: 10, fontSize: 13 }}>
                {t.restOfSchool}
              </div>
            )}
            <section style={{ display: "grid", gap: 10 }}>
              {rest.map((e, i) => {
                return (
                  <div
                    key={e.id}
                    style={{
                      background: "#fff",
                      borderRadius: "8px 24px 8px 24px",
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      boxShadow: "0 4px 14px -8px rgba(3,8,15,.4)",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div className="display" style={{ width: 26, textAlign: "center", fontSize: 16, color: "var(--accent)", zIndex: 1 }}>
                      {i + 4}
                    </div>
                    <div style={{ zIndex: 1 }}>
                      <Avatar src={e.avatarUrl} name={e.displayName || e.tiktokUser} size={36} />
                    </div>
                    <div style={{ flex: 1, zIndex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {e.displayName || `@${e.tiktokUser}`}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
                        @{e.tiktokUser}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", zIndex: 1 }}>
                      <div style={{ fontWeight: 800, color: "var(--accent-2)" }}>
                        {e.coins.toLocaleString()} 🪙
                      </div>
                    </div>
                  </div>
                );
              })}
              {entrants.length === 0 && (
                <Center>{t.noCoins}</Center>
              )}
            </section>
          </>
        )}

        <footer style={{ textAlign: "center", marginTop: 48, color: "var(--accent)", fontSize: 13, fontWeight: 600 }}>
          {t.footer}
        </footer>
      </main>
    </>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", color: "var(--accent-2)", padding: "40px 0", fontWeight: 600 }}>
      {children}
    </div>
  );
}
