import { injectNavBar, isAuthConfigured } from "./auth/index";
import { resolveInitialSession } from "./auth-gate";

/**
 * Downstream auth gate for the level-select page.
 *
 * The landing page is the sign-in surface. If a user lands here with auth
 * configured but no session, bounce them home so they can sign in. When
 * Supabase is unconfigured (local dev without `.env`), skip the gate so
 * contributors can play without setting up Supabase. Production is
 * unaffected — env is present there, gate behaves as before.
 */
async function boot(): Promise<void> {
  const user = await resolveInitialSession();
  if (!user && isAuthConfigured) {
    window.location.href = "./index.html";
    return;
  }
  if (user) injectNavBar();
}

void boot();
