/**
 * Palette + numeric constants for the cyberpunk iso renderer.
 * Mirrors the showcase tokens so phase 1B HUD integration reuses the same values.
 */
export const CYBERPUNK_TOKENS = {
  palette: {
    bg: 0x050816,
    tileLine: 0x1a3060,
    connection: 0x5ef0ff,
    connectionDim: 0x3a8fa0,
    packet: 0xaef7ff,
    packetReturn: 0x5ef0ff,
    selectionRing: 0x5ef0ff,
    ghost: 0xaef7ff,
    flashOverload: 0xff4d4d,
    flashDrop: 0xff9c4d,
    flashResponded: 0x5ef0ff,
  },
  scale: {
    /** Integer pixel scale for 64px component sprites. */
    spriteScale: 1,
    /** Floor tile rendered at 1.25× the native 64px. */
    tileScale: 1.25,
    /** Iso lattice half-width — matches 64 × tileScale / 2 = 40. */
    isoHalfWidth: 40,
    /** Iso lattice half-height (classic 2:1). */
    isoHalfHeight: 20,
  },
  board: {
    /** Board extent in tiles (N×N). Even so the origin is on a tile corner. */
    size: 24,
  },
  timing: {
    /** Default packet traversal fallback if durationMs is missing or invalid. */
    defaultPacketTraversalMs: 1200,
    /** Max age of a pending flash before firing anyway (ms). */
    maxPendingFlashAgeMs: 1500,
  },
  cable: {
    /** Outer casing stroke width. */
    outerWidth: 12,
    /** Core stroke width. */
    coreWidth: 8,
    /** Highlight stroke width. */
    highlightWidth: 2,
  },
} as const;
