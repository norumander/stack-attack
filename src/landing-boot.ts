import {
  waitForAuth,
  waitForProfile,
  showLoginOverlay,
  hideLoginOverlay,
  showProfileSetup,
  injectNavBar,
  isAuthConfigured,
} from "./auth/index";
import { resolveInitialSession } from "./auth-gate";

/**
 * Entry-point auth gate for the landing page.
 *
 * Production (Supabase configured):
 * 1. Wait for Supabase to resolve any saved session.
 * 2. If signed out, show the login overlay and block until the user signs in.
 * 3. First-time users (no profile row) go through profile setup.
 * 4. Once authed + profiled, inject the top-right nav bar.
 *
 * Local dev (Supabase unconfigured): skip the auth gate entirely so
 * contributors can click PLAY without needing Supabase credentials. The
 * landing content renders; downstream boot scripts also skip their gates
 * (see levels-boot, diagnose-boot, physics-td/physics-td.ts).
 */
async function boot(): Promise<void> {
  if (!isAuthConfigured) {
    return; // dev bypass: let user navigate freely without Supabase
  }

  // Block the CTA up-front while the session resolves. If Supabase restores
  // a saved session we hide the overlay; otherwise the user stays blocked
  // until they sign in. This prevents a race where the user clicks PLAY
  // before resolveInitialSession() returns and gets bounced back by
  // levels-boot's auth gate.
  showLoginOverlay();
  const user = await resolveInitialSession();

  if (!user) {
    await waitForAuth();
  }
  hideLoginOverlay();

  // Profile fetch runs in the background (auth-state.ts emits profile_ready
  // separately from signed_in). Wait for it here so we don't flash the
  // setup overlay at users who already have a profile row.
  const profile = await waitForProfile();
  if (!profile) {
    await showProfileSetup();
  }

  injectNavBar();
}

void boot();
