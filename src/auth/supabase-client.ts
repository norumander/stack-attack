import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "[auth] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — auth disabled",
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");
