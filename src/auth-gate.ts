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
 * Timeout: capped at `timeoutMs` (default 3s) to avoid hanging forever when
 * Supabase is misconfigured (e.g. missing VITE_SUPABASE_URL in a dev checkout
 * without a `.env`). A real cold-token refresh completes in well under 3s;
 * exceeding the ceiling means Supabase isn't going to respond at all, so we
 * resolve null and let the boot-script redirect to the landing page.
 */
export function resolveInitialSession(timeoutMs = 3000): Promise<User | null> {
  return new Promise((resolve) => {
    const existing = getUser();
    if (existing) {
      resolve(existing);
      return;
    }

    let settled = false;
    const finish = (user: User | null) => {
      if (settled) return;
      settled = true;
      unsub();
      clearTimeout(timer);
      resolve(user);
    };

    const unsub = onAuthChange((event) => {
      finish(event.type === "signed_in" ? event.user : null);
    });

    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}
