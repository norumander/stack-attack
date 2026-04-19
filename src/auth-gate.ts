import type { User } from "@supabase/supabase-js";
import { getUser, onAuthChange } from "./auth/index";

/**
 * Resolve the initial Supabase session on page load.
 *
 * Supabase restores sessions asynchronously — `getUser()` returns `null`
 * immediately after page load even when a valid session exists in storage.
 * This helper waits for the first `onAuthChange` event (or a short timeout)
 * and returns the resulting user, or `null` if signed out.
 *
 * Used by every entry point that needs to gate on auth before rendering.
 */
export function resolveInitialSession(timeoutMs = 2000): Promise<User | null> {
  return new Promise((resolve) => {
    const existing = getUser();
    if (existing) {
      resolve(existing);
      return;
    }
    let done = false;
    const finish = (user: User | null) => {
      if (done) return;
      done = true;
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
