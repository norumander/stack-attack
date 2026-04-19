import { signInWithGoogle } from "./auth-state";

const OVERLAY_ID = "sa-login-overlay";

export function showLoginOverlay(): void {
  if (document.getElementById(OVERLAY_ID)) return;

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "sa-login-overlay";

  overlay.innerHTML = `
    <div class="sa-login-card">
      <div class="sa-login-logo">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect x="4" y="20" width="16" height="24" rx="2" fill="#4A90D9" opacity="0.9"/>
          <rect x="24" y="12" width="16" height="32" rx="2" fill="#7B68EE" opacity="0.9"/>
          <rect x="14" y="4" width="16" height="12" rx="2" fill="#F5A623" opacity="0.9"/>
          <circle cx="12" cy="32" r="3" fill="#22c55e"/>
          <circle cx="32" cy="28" r="3" fill="#22c55e"/>
        </svg>
      </div>
      <h1 class="sa-login-title">Stack Attack</h1>
      <p class="sa-login-tagline">Learn System Architecture by Defending It</p>
      <button class="sa-login-btn" id="sa-google-signin">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
          <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 6.29C4.672 4.163 6.656 2.58 9 3.58z" fill="#EA4335"/>
        </svg>
        Sign in with Google
      </button>
      <p class="sa-login-footer">Strategy game first. The learning is the surprise.</p>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("sa-google-signin")!.addEventListener("click", () => {
    signInWithGoogle();
  });
}

export function hideLoginOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
