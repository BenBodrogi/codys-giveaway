import React from "react";

// Palette blues for the initial fallback. Deterministic per name so a
// given person always gets the same colour, but the board stays varied
// and on-palette. (Sea foam bg is excluded — too light for white text.)
const COLORS = ["#146C94", "#1F9EBF", "#0F3057", "#03080F"];

function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function initial(name: string): string {
  const clean = name.replace(/^@/, "").trim();
  return clean ? clean[0].toUpperCase() : "?";
}

export function Avatar({
  src,
  name,
  size = 40,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: pickColor(name),
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 800,
        fontSize: size * 0.42,
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {initial(name)}
    </div>
  );
}
