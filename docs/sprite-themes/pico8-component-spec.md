# Pico-8 Retheme — Component Spec Sheet

Drop this into any sprite-generation tool (Aseprite / Stable Diffusion / PixelLab / commissioned artist). All 21 sprites + constraints in one place.

## Global constraints

- **Palette:** strict Pico-8 16-color. No off-palette pixels. No anti-aliasing, no gradients.
  ```
  #000000 #1D2B53 #7E2553 #008751 #AB5236 #5F574F #C2C3C7 #FFF1E8
  #FF004D #FFA300 #FFEC27 #00E436 #29ADFF #83769C #FF77A8 #FFCCAA
  ```
- **Background:** fully transparent (RGBA PNG).
- **Outline:** hard black `#000000` 1-pixel outline around every opaque shape.
- **Rendering:** nearest-neighbor scaling, no blur, crisp pixel edges.

## Isometric projection (what angle?)

- **2:1 dimetric isometric** (sometimes called "video-game isometric" — not true 30° iso).
- Tiles are drawn as **diamonds 80 px wide × 40 px tall** on screen.
- Source tile PNG is 64×64; the iso diamond sits inside it with transparent corners. Renderer scales to 80×80 (which is why 64×64 sources look 80×80 on screen).
- Camera appears to be roughly 27° above horizontal (`atan(1/2)`), looking down-right.
- Grid axes on screen:
  - `+X` grid direction (east) → down-right (slope 1:2)
  - `+Y` grid direction (south) → down-left (slope 1:2)
  - Grid `(0,0)` is the **top** (far corner) of the board; grid `(N,N)` is the **bottom** (near corner closest to camera).

A reference: each component sits on exactly one floor tile. The tile's footprint is the 80×40 diamond. Component sprites may extend **upward and sideways** past the tile but their anchor point is the tile's center.

## Canvas sizes per asset type

| Asset | Source PNG size | Render footprint | Notes |
|---|---|---|---|
| Floor tile (`tile_light`, `tile_dark`) | 64×64 | 80×80 (iso diamond fills 80×40) | Iso diamond shape with transparent corners |
| Component (most) | 48×48 or 64×64 | Component anchors at tile center, may extend up | Variable per component — allow taller sprites for tall objects |
| Packet icon (`packet_read`, `packet_write`) | 16×16 | 16×16 | Small flying icon that travels along connection lines |
| Back wall segment | 64×64 (tileable strip) | Repeats along both back edges | See wall section below |
| Logo decal | 48×32 or 64×32 | Mounted on wall | Recognizable company logo framed as a poster |

## The 14 components

Each entry: type ID (filename basename), short description, key recognition features.

### Edge / ingress

1. **`client`** — `client-typing.png` (reuse landing-page asset, static first frame) — small person at a desk typing, cream skin, orange hoodie, gray desk with CRT monitor. The user at their computer.
2. **`dns_gtm`** — `dns_gtm.png` — rotary phone switchboard panel with patch cables / directory icon. Routes traffic by phone-operator metaphor.
3. **`cdn`** — `cdn.png` — satellite dish / antenna on a rack shelf with concentric rings and a focal-point glow. Delivers content from the edge.
4. **`edge_cache`** — `edge_cache.png` — mini-fridge-sized box with a globe sticker and antenna nub on top. Faster/closer-feeling than CDN.

### Gateway / routing

5. **`api_gateway`** — `api_gateway.png` — badge-reader / security checkpoint terminal with lock-icon screen and card slot. Validates incoming requests.
6. **`load_balancer`** — `load_balancer.png` — flat wide network switch box, row of blinking ethernet LEDs across the front, tiny display with rotating-arrow icon. Distributes load across servers.
7. **`circuit_breaker`** — `circuit_breaker.png` — electrical breaker panel on a small wall mount, big flip switch in the middle (up = closed, down = tripped), red/green indicator on top. Fails fast under overload.

### Compute

8. **`server`** — `server.png` — cream-beige 1990s desktop PC tower, small power button, one blue LED dot, visible fan grille, thick power cable. The workhorse.
9. **`worker`** — `worker.png` — beige desktop with a chunky CRT monitor showing a progress bar, keyboard in front, "BUSY" LED on the bezel. Processes async jobs.
10. **`streaming_server`** — `streaming_server.png` — VHS / cassette tape deck with visible spinning reels, blue "PLAY" triangle on the front display, chunky play/stop buttons. Pushes video.

### Storage

11. **`database`** — `database.png` — classic DB icon: a **stack of 3 horizontal cylinders** (like tuna cans stacked) viewed at iso angle, cream top face (ellipse, not square), lavender-grey cylindrical side body with two horizontal bands. Clearly **round**, not boxy.
12. **`data_cache`** — `data-cache.png` — small RAM-stick-sized vertical unit in a bracket, blue PCB traces along its edge. Smaller/faster than database.
13. **`blob_storage`** — `blob_storage.png` — tall 3-drawer filing cabinet with chunky handles, one drawer slightly open showing colored folders inside, label slots glow blue on each drawer front.
14. **`queue`** — `queue.png` — stacked inbox/outbox paper tray with pixel-art documents piling up, tiny LED counter showing queue depth, papers glow blue along the edges.

## Floor tiles

- **`tile_light.png`** — 64×64 PNG. Pixel art of an iso-diamond floor tile in warm cream carpet (`#FFF1E8` body, `#FFCCAA` accent). Transparent outside the diamond.
- **`tile_dark.png`** — same as `tile_light` but one shade darker (`#FFCCAA` body, `#AB5236` accent) for checkerboard contrast.

## Walls — "looking into the office"

Rendering concept: the two **back walls** (far-right + far-left in the iso view) are drawn; the two **front walls** (near-right + near-left, which would otherwise block the camera's view of the floor) are omitted. Reads as an open-fronted doll-house / The Sims style room.

- **`back_wall.png`** — 64×64 tileable strip. Pixel art of one vertical section of interior office wall, drawn at the same iso angle as the floor. Looks like painted wall (beige or navy), chair rail running along the bottom, repeatable horizontally. When instantiated in the renderer, this sprite is repeated N times along the NE edge (grid Y = 0 row) AND mirrored + repeated along the NW edge (grid X = 0 column), so both back walls meet at the far corner `(0, 0)`.
- **Alternative** if one tileable strip is hard: deliver two sprites — `back_wall_ne.png` and `back_wall_nw.png` — already oriented for each edge. Tell me which you prefer.

## Packets

- **`packet_read.png`** — 16×16. Tiny pixel icon of an open envelope or document with a magnifying glass. Blue accent (`#29ADFF`). Represents a GET / read request flying along a connection line.
- **`packet_write.png`** — 16×16. Tiny pixel icon of a pencil writing on a page, or a sealed envelope with a pink wax seal. Pink/red accent (`#FF77A8` or `#FF004D`). Represents a POST / write request.

## Logo decals (one per campaign)

All three framed as small posters hanging on the back wall. Each: 48×32 or 64×32, chunky dark frame, readable pico-8-style logo inside.

- **`logos/netflix.png`** — red "NETFLIX" wordmark (`#FF004D`) in a chunky black frame.
- **`logos/bitly.png`** — orange "bit.ly" wordmark (`#FFA300`) in a chunky black frame.
- **`logos/instagram.png`** — pink pixel camera icon (`#FF77A8`) — rounded square with lens circle and small indicator dot — in a chunky black frame.

## File layout

```
src/assets/
  server.png
  database.png
  data-cache.png            (note the hyphen — existing convention)
  load_balancer.png
  cdn.png
  api_gateway.png
  queue.png
  worker.png
  streaming_server.png
  edge_cache.png
  dns_gtm.png
  blob_storage.png
  circuit_breaker.png
  tile_light.png
  tile_dark.png
  packet_read.png
  packet_write.png
  back_wall.png
  client-typing.png         (reused from landing; extract first frame of GIF)
  logos/
    netflix.png
    bitly.png
    instagram.png
```
