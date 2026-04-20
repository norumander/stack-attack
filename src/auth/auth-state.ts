import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase-client";
import type { Profile } from "./database.types";

// ─── Types ───────────────────────────────────────────────────────────
export type AuthEvent =
  | { type: "signed_in"; user: User; profile: Profile | null }
  | { type: "signed_out" }
  | { type: "profile_ready"; profile: Profile };

type AuthListener = (event: AuthEvent) => void;

// ─── State ───────────────────────────────────────────────────────────
let currentUser: User | null = null;
let currentProfile: Profile | null = null;
const listeners: AuthListener[] = [];

// ─── Pub/sub ─────────────────────────────────────────────────────────
export function onAuthChange(fn: AuthListener): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function emit(event: AuthEvent): void {
  for (const fn of listeners) fn(event);
}

// ─── Profile fetch ───────────────────────────────────────────────────
// Guarded so a single in-flight fetch can't pile up behind itself when
// onAuthStateChange fires multiple events in quick succession. Deduping
// matters because a hung SELECT on an HTTP/2 connection will block every
// subsequent request behind it — including writes the user is trying to
// perform from the UI.
let inFlightProfileFetch: Promise<Profile | null> | null = null;

function fetchProfile(userId: string): Promise<Profile | null> {
  if (inFlightProfileFetch) return inFlightProfileFetch;
  inFlightProfileFetch = (async () => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();
      return data;
    } finally {
      inFlightProfileFetch = null;
    }
  })();
  return inFlightProfileFetch;
}

// ─── Public API ──────────────────────────────────────────────────────
export function getUser(): User | null {
  return currentUser;
}

export function getProfile(): Profile | null {
  return currentProfile;
}

export function setProfile(profile: Profile): void {
  currentProfile = profile;
  emit({ type: "profile_ready", profile });
}

/** Save current game hash before OAuth redirect, then sign in with Google. */
export async function signInWithGoogle(): Promise<void> {
  localStorage.setItem("sa_pre_auth_hash", window.location.hash);

  const redirectTo = window.location.origin + window.location.pathname;
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  window.location.reload();
}

/**
 * Returns a promise that resolves once the user has a valid session.
 * If the user is already signed in, resolves immediately.
 */
export function waitForAuth(): Promise<User> {
  return new Promise((resolve) => {
    if (currentUser) {
      resolve(currentUser);
      return;
    }
    const unsub = onAuthChange((event) => {
      if (event.type === "signed_in") {
        unsub();
        resolve(event.user);
      }
    });
  });
}

/**
 * Wait until the background profile fetch resolves (or fails). Use this in
 * boot scripts to decide whether a user needs to go through profile setup —
 * without it, the `profile: null` that `signed_in` now carries would trigger
 * setup for users who already have a profile row.
 *
 * Resolves with the profile (or null if the user has none), or null on
 * timeout. Never rejects.
 */
export function waitForProfile(timeoutMs = 6000): Promise<Profile | null> {
  return new Promise((resolve) => {
    if (currentProfile) {
      resolve(currentProfile);
      return;
    }
    let settled = false;
    const finish = (profile: Profile | null) => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve(profile);
    };
    const unsub = onAuthChange((event) => {
      if (event.type === "profile_ready") finish(event.profile);
      if (event.type === "signed_out") finish(null);
    });
    const timer = setTimeout(() => finish(currentProfile ?? null), timeoutMs);
  });
}

// ─── Bootstrap ───────────────────────────────────────────────────────
// Emit `signed_in` synchronously with the user only. The profile fetch
// runs in the background and emits `profile_ready` when it resolves.
// Splitting these two events is what prevents a slow/hung SELECT from
// blocking the auth-gate timeout — callers that only need the user
// (`resolveInitialSession`, `waitForAuth`) unblock in milliseconds even
// when Supabase's REST endpoint is cold.
supabase.auth.onAuthStateChange((_eventType, session: Session | null) => {
  if (session?.user) {
    currentUser = session.user;

    const savedHash = localStorage.getItem("sa_pre_auth_hash");
    if (savedHash) {
      localStorage.removeItem("sa_pre_auth_hash");
      if (window.location.hash !== savedHash) {
        window.history.replaceState(null, "", savedHash || "#");
      }
    }

    emit({ type: "signed_in", user: currentUser, profile: currentProfile });

    // Fire-and-forget: populate currentProfile in the background and emit
    // profile_ready for UIs that want to wait on it (nav bar, landing).
    fetchProfile(session.user.id)
      .then((profile) => {
        currentProfile = profile;
        if (profile) emit({ type: "profile_ready", profile });
      })
      .catch((err) => {
        console.warn("[auth] background fetchProfile failed:", err);
      });
  } else {
    currentUser = null;
    currentProfile = null;
    emit({ type: "signed_out" });
  }
});
