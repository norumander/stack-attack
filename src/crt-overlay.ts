/**
 * Mount the CRT overlay (scanlines + vignette + sync-bar beam + flicker)
 * on the current page. Styled by .crt-frame / .crt-beam in auth.css.
 * Safe to call more than once — the frame is only mounted if missing.
 */
function mountCrtOverlay(): void {
  if (document.querySelector(".crt-frame")) return;
  const frame = document.createElement("div");
  frame.className = "crt-frame";
  frame.setAttribute("aria-hidden", "true");
  const beam = document.createElement("div");
  beam.className = "crt-beam";
  frame.appendChild(beam);
  document.body.appendChild(frame);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountCrtOverlay, { once: true });
} else {
  mountCrtOverlay();
}
