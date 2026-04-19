import type { User } from "@supabase/supabase-js";
import { getUser, onAuthChange } from "./auth/index";

/**
 * Resolve the initial Supabase session on page load.
 *
 * Supabase restores sessions asynchronously — `getUser()` returns `null`
 * immediately after page load even when a valid session exists in storage.
 * This helper waits for Supabase's first `onAuthChange` event (fired exactly
 * once at init, either `signed_in` with the restored user or `signed_out`)
 * and returns the user or null.
 *
 * No timeout: Supabase's async restore can take several seconds on a cold
 * token refresh, and a premature null resolution would incorrectly bounce an
 * authenticated user back to the landing page.
 */
export function resolveInitialSession(): Promise<User | null> {
  return new Promise((resolve) => {
    const existing = getUser();
    if (existing) {
      resolve(existing);
      return;
    }
    const unsub = onAuthChange((event) => {
      unsub();
      resolve(event.type === "signed_in" ? event.user : null);
    });
  });
}
