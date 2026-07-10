import { NextRequest } from "next/server";
import { adminAuth } from "./firebaseAdmin";

// Admin gate. The client signs in via Firebase Auth (email+password) and
// sends a fresh ID token as a Bearer header on every request (tokens expire
// hourly, so the client re-fetches one per call rather than caching it).
// We verify the token server-side and check the email against ADMIN_EMAILS
// (comma-separated env).
export async function requireAdmin(
  req: NextRequest
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const header = req.headers.get("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return { ok: false, error: "missing token" };

  let email: string | undefined;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    email = decoded.email;
  } catch {
    return { ok: false, error: "invalid token" };
  }
  if (!email) return { ok: false, error: "invalid token" };

  const allow = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!allow.includes(email.toLowerCase())) {
    return { ok: false, error: "not an admin" };
  }
  return { ok: true, email };
}
