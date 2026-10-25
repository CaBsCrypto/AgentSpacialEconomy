# ONE16 — observed-route reconstruction

This editable model reconstructs architecture and furniture visible in sampled frames of the user's 2:52 walkthrough. It is not a photogrammetric scan or measured survey. No raw video, attendee images, badges, screens, or private image textures are embedded.

## Evidence versus estimation

Official venue information reports 3,200 m² open space, 4.5–7 m ceiling height, and 36 river-facing windows along 50 m frontage. These are whole-venue claims, not proof of this reconstructed section's dimensions. Source: https://www.oneyourfirststop.com/eventos (technical sheet).

The model's 30 × 50 m local canvas represents an approximate observed portion, not the entire venue. Its width, depth, zone placements, doorway positions, table/chair counts, partitions and furniture sizes are adjustable estimates. A 64 m depth was not inferred from area/frontage. Broad visual style and zone presence are high confidence; exact metric geometry and orientation are low confidence.

Observed elements: yellow-railed approach and blue/yellow lounge, black-cloth buffet, blue counter/yellow flag, gray multi-pane glazed room, bright window-side tables, timber planks with paired flush tracks, exposed Y-braced columns and roof trusses, skylights, checkerboard photo wall and poufs, low black HackMeridian stage with yellow backdrop and silver truss, partial black curtain screen, hacking tables, two auditorium chair banks, casual tables.

Typography and illustrated motifs are reconstructed/simplified. Small partner marks were not legible enough to reproduce and are not invented.

## Rebuild

`blender -b -t 6 --python model/build_venue.py`

Writes the editable `.blend`, binary `.glb`, `layout.json`, hero and overview renders. Cycles denoising is disabled because the available build lacks OpenImageDenoise. The scene uses no external textures.

Blender is Z-up; GLB export converts Blender `(x,y,z)` to Three `(x,z,-y)`. `layout.json` is already in Three coordinates. `roof • removable pitched timber and skylights` is independently hideable for cutaway views. Camera eye height is 1.65 m above the main floor. The raised ramp and stage are collision obstacles, not falsely traversable flat floor.

All zone viewpoints and spawn were checked with the viewer's `canStand` function. The hacking waypoint is x=-6,z=-19 to avoid table clearance. Full navigation/path testing and GLTFLoader parse are performed by the Site owner.

## V2 entrance / arrival correction

Two supplemental user videos were directly inspected in full-timeline sampled frames. They correct the original entrance assumption: a narrow low-level enclosed loading passage leads straight into a lower lounge, then seven yellow stair risers rise into the main hall. The merch area is on the arriving visitor's left, supported by the second video's left pan, the stair arrow and the user's clarification.

The obsolete raised yellow pier inside the main hall has been removed. New geometry includes weathered masonry/side stone strips, red-brown sliding doors and braces, yellow runner, suspended black/yellow umbrella canopies, bilateral blue-chair/mustard-pouf lounge, actual seven-step mesh with sagging rope handrails, upper guardrails, check-in overhead banner, and left-side apparel racks/merch banner/graphic-and-mirror backdrop/counter. No attendees, badges or raw footage are included.

New local scale remains estimated: corridor length 26 m and width 4.4 m; seven rises of 0.15 m connect a lower level at −1.05 m to the existing hall at 0 m. These are navigable reconstruction parameters, not measured venue claims. The lower annex is outside the original hall slab, so there is no overlapping slab across the sunken approach. Original main-hall geometry is retained beyond the arrival area.

`layout.surfaces` supplies planar height bands in Three coordinates. Step bands come first, followed by lower lounge/corridor polygons; default main hall height is zero. The main centerline is x=0, z=28 down to z<0. Stairs rise while z decreases from 2.45 to 0. Merch is negative X (left when entering toward negative Z).

Rebuild geometry: `blender -b -t 6 --python model/build_venue.py`.
Render final v2 `hero.jpg`, `stairs.jpg`, `merch.jpg` and `overview.jpg`: `blender -b -t 6 --python model/render-v2.py`.

## Proposed activation kiosk (A)

A user-requested visual concept has been added at the right of arrival, opposite merch: Blender `(7,4,0)` / Three `(7,0,-4)`. It is explicitly marked `PROPUESTA`, `CONCEPTO TESTNET`, `XLM de prueba`, `USDC de prueba` and `SIN VALOR REAL`. There are no live wallet addresses, QR destinations, credentials, faucet calls, transactions or mainnet functionality in this model.

`model/totem.py` builds the kiosk as a separate parented component; the original architecture and event furniture remain unchanged. Approximate dimensions: 0.80 × 0.65 m base, 1.93 m height. Its conservative collision rectangle is x=[6.4,7.6], z=[−4.6,−3.4]. Zone `activation` has a clear approach viewpoint x=5.8,z=−1.4. Placement requires on-site validation before any physical installation.

Full current GLB was parsed by the actual Three.js GLTFLoader: 8,700,920 bytes, 256 meshes, 285,161 vertices. All 11 zone viewpoints are standable and connected from the entrance on a 0.25 m collision/elevation grid (20,726 reachable samples). Forward and reverse stair traversal remain valid.

The kiosk screen is informational only: the earlier mock action button was removed and replaced by plain “Flujo por definir” text. No claim-ready controls or QR codes are present.

## Exterior approach (additional user clip)
`exterior.py` adds a connected forecourt at the original corridor mouth, white doorway facade, outward grey door leaves/red panic bars, reconstructed yellow welcome banner, Check In Area feather flag and a covered raised railway-side platform with descending concrete steps. Exact sign text was read from private exterior video: WELCOME, BUILDERS. / What happens next starts with you / OCTOBER 25–26 · LISBON. Banner illustration is simplified procedural Lisbon/tram imagery, not footage. No people, private source images or badges are embedded.
All exterior dimensions, angles and exterior step count are approximate; eight 0.15m modeled exterior rises are a navigation reconstruction, NOT a measured/visually counted fact. The seven interior yellow risers remain separate and unchanged. Railway geometry is background and excluded from walkable polygons. Default spawn is forecourt facing banner; `exteriorRoute` supplies a reversible route from raised platform to original corridor. Exterior module called by main generator before saving.

## Exterior entrance revision (2026-10-25)
New private video confirms a covered railway-side platform, descending concrete exterior stairs, a lower forecourt, grey outward-open doors with red panic bars, and a yellow welcome banner before the existing corridor. Reconstructed text: `WELCOME, BUILDERS.`, `What happens next starts with you`, `OCTOBER 25–26 · LISBON`. Banner illustrations are simplified modeled graphics, not private photo textures.

Default start/reset is the forecourt facing the sign. Exterior dimensions, global alignment, and eight modeled exterior risers are estimates; the exterior riser count is NOT an observed count. The seven yellow interior risers remain separately verified from the earlier video. Railway geometry is background only and excluded from walkable polygons. All 13 zone viewpoints are reachable; stair-side rail clearance requires the turn at z36.8, not z37. Native no-WebGL static plan is generated from the same layout with `python scripts/static-tour.py`. Exact gzip transfer is regenerated with `python scripts/prepare-model.py`.

## Passport proposed AR display
`passport.py` appends the packed standalone `passport-component.blend` at physical small-book scale, on a proposed pedestal beside the activation concept (Three x8.7,z−3). Exact supplied front JPEG is embedded, no redraw. Back/thickness/pages estimated. Illustrative Bronze III/1,275 PTS is artwork, not authenticated user data. Existing geometry is unchanged; pedestal collision and zone14 added. Model now contains one JPEG texture; browser image decode must be covered by validation (previous image-free Node validation alone is insufficient).
