export { supabase, isAuthConfigured } from "./supabase-client";
export {
  waitForAuth,
  waitForProfile,
  getUser,
  getProfile,
  signInWithGoogle,
  signOut,
  onAuthChange,
} from "./auth-state";
export { showLoginOverlay, hideLoginOverlay } from "./login-overlay";
export { showProfileSetup } from "./profile-setup";
export { injectNavBar } from "./nav-bar";
export { saveProgress, loadProgress, clearProgress, debouncedSave } from "./game-progress";
export { submitLeaderboardEntry } from "./leaderboard";
export type { Profile, GameProgress, LeaderboardEntry } from "./database.types";
export type { ProgressData } from "./game-progress";
