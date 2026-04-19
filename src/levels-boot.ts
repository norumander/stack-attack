import { injectNavBar } from "./auth/index";
import { resolveInitialSession } from "./auth-gate";

/**
 * Downstream auth gate for the level-select page.
 *
 * The landing page is the sign-in surface. If a user lands here directly
 * without a session, bounce them home so they can sign in. Otherwise
 * render the nav bar (profile + leaderboard) on top of the level list.
 */
async function boot(): Promise<void> {
  const user = await resolveInitialSession();
  if (!user) {
    window.location.href = "./index.html";
    return;
  }
  injectNavBar();
}

void boot();
