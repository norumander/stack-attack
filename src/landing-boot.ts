import {
  waitForAuth,
  getProfile,
  showLoginOverlay,
  hideLoginOverlay,
  showProfileSetup,
  injectNavBar,
} from "./auth/index";
import { resolveInitialSession } from "./auth-gate";

/**
 * Entry-point auth gate for the landing page.
 *
 * 1. Wait for Supabase to resolve any saved session.
 * 2. If signed out, show the login overlay and block until the user signs in.
 * 3. First-time users (no profile row) go through profile setup.
 * 4. Once authed + profiled, inject the top-right nav bar.
 *
 * Anonymous visitors stay on the overlay; signed-in visitors see the landing
 * content that was server-rendered in `index.html` (STACK ATTACK + PLAY).
 */
async function boot(): Promise<void> {
  const user = await resolveInitialSession();

  if (!user) {
    showLoginOverlay();
    await waitForAuth();
    hideLoginOverlay();
  }

  if (!getProfile()) {
    await showProfileSetup();
  }

  injectNavBar();
}

void boot();
