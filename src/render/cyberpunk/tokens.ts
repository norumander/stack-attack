/**
 * Palette + numeric constants for the cyberpunk iso renderer.
 * Mirrors the showcase tokens so phase 1B HUD integration reuses the same values.
 */
export const CYBERPUNK_TOKENS = {
  palette: {
    bg: 0x1d2b53,             // pi-navy — canvas background
    tileLine: 0x1d2b53,       // pi-navy — grid lines on floor tiles
    connection: 0x29adff,     // pi-blue — active connection
    connectionDim: 0x83769c,  // pi-lavender — idle connection
    packet: 0x29adff,         // pi-blue — forward packet
    packetReturn: 0xffec27,   // pi-yellow — return packet
    selectionRing: 0xffec27,  // pi-yellow — selection highlight
    ghost: 0xffccaa,          // pi-peach — placement ghost
    flashOverload: 0xff004d,  // pi-red
    flashDrop: 0xffa300,      // pi-orange
    flashResponded: 0x00e436, // pi-green
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
    size: 30,
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
