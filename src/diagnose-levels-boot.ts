import { injectNavBar, isAuthConfigured } from "./auth/index";
import { resolveInitialSession } from "./auth-gate";

/**
 * Auth gate for the diagnose-level-select page.
 *
 * Mirrors levels-boot.ts — the landing page is the sign-in surface; if the
 * user reaches diagnose-levels.html with auth configured but no session,
 * bounce them home. Local dev without Supabase skips the gate.
 */
async function boot(): Promise<void> {
  const user = await resolveInitialSession(8000);
  if (!user && isAuthConfigured) {
    window.location.href = "./index.html";
    return;
  }
  if (user) injectNavBar();
}

void boot();
