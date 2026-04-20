import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True when Supabase env vars are present. When false we still construct a
 * client (so imports don't crash), but callers should treat all auth
 * operations as no-ops. Exported so boot scripts can short-circuit the
 * redirect-when-unauthenticated gate.
 */
export const isAuthConfigured: boolean = Boolean(supabaseUrl && supabaseAnonKey);

if (!isAuthConfigured) {
  console.warn(
    "[auth] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — auth disabled",
  );
}

// createClient validates its first arg as a URL; passing "" throws synchronously.
// When env is missing, pass a structurally-valid stub URL so the module imports
// cleanly. Requests through the stub will error at runtime; isAuthConfigured
// is the guard callers should use.
const STUB_SUPABASE_URL = "https://stub.supabase.co";
const STUB_ANON_KEY = "stub-anon-key";

export const supabase = createClient(
  supabaseUrl || STUB_SUPABASE_URL,
  supabaseAnonKey || STUB_ANON_KEY,
);
