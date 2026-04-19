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
async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  return data;
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

// ─── Bootstrap ───────────────────────────────────────────────────────
supabase.auth.onAuthStateChange(async (_eventType, session: Session | null) => {
  if (session?.user) {
    currentUser = session.user;
    currentProfile = await fetchProfile(session.user.id);

    const savedHash = localStorage.getItem("sa_pre_auth_hash");
    if (savedHash) {
      localStorage.removeItem("sa_pre_auth_hash");
      if (window.location.hash !== savedHash) {
        window.history.replaceState(null, "", savedHash || "#");
      }
    }

    emit({ type: "signed_in", user: currentUser, profile: currentProfile });
  } else {
    currentUser = null;
    currentProfile = null;
    emit({ type: "signed_out" });
  }
});
