# ONE16 · HackMeridian spatial reconstruction

Independent user-requested Site, created 25 October 2026. Original event footage and inspection screenshots are private and deliberately excluded from this checkout and all published assets.

## Evidence

- Venue technical sheet: https://static1.squarespace.com/static/68416d6a7f541b46db5db34b/t/68416eeeee8b0741ea84a074/1749118704205/ONE16%2B(Armaz%C3%A9m%2B16)_Ficha%2BT%C3%A9cnica%2B2025.pdf
- Venue: https://www.oneyourfirststop.com/eventos
- Event: https://www.hackmeridian.com/

The official published venue facts are 3,200m² open space, ceiling height 4.5–7m, and 36 river-facing windows on a 50m frontage. They are NOT an exact model footprint. Do not divide area by frontage to invent building depth.

The private 2:52 walkthrough was visually inspected at samples across its full duration. Observed features: yellow entrance route, lower lounge and seven-step ascent (corrected in v2); blue lounge chairs and mustard ottomans; timber floors and dark/grey braced warehouse frame; black-clothed buffet; river-facing windows and framed glazed room; yellow/black photo wall; low black stage, yellow backdrop, silver lighting truss; black-curtained workshop zone; white hack tables and dark chairs; auditorium central aisle and casual dining zone.

Local geometry scale, spacing, room connections, furniture counts and placement are interpretive estimates. The model reconstructs the observed route, not a surveyed full building. Hidden spaces are not claimed to be verified. No people, personal badges, private screens or raw video are included.

## Rebuild

- Three.js is pinned to 0.180.0. Run Sites dependency helper for install, then `node scripts/vendor.mjs` to copy recursive browser dependency graph.
- `npm test` validates camera-relative movement, diagonal normalization, collision bounds, long-frame clamp, repeated mode changes, and absence of fabricated walkable floor.
- `blender -b --python model/build_venue.py` generates model assets (see script for local output directory).
- `node scripts/validate-glb.mjs dist/assets/one16.glb` runs the real GLTFLoader parser against the complete asset.
- Static hosting directory: `dist`.

## Viewer

Desktop WASD/arrows + drag; touchscreen buttons + drag; overview orbit/pinch; top-down interpretive plan; direct zone viewpoints; return preserves position. The 3D path requires WebGL. A clear error and real layout plan replace unavailable rendering; no simulated walking is claimed.

## Entrance / merch revision (v2)

Two additional private clips (40.76s entrance and 11.78s arrival/merch) were decoded and visually sampled across their durations, with full-resolution stair/landing/merch inspection. They correct the first version's entrance topology: the yellow route is a long, low-level masonry corridor with rusty sliding doors and suspended black/yellow umbrellas, leading through a lower lounge to exactly seven visible yellow steps. Check-in is ahead after ascent; merch is on the arrival-relative left. The old in-hall yellow pier is removed. Lengths, widths and riser heights remain estimates, not measured facts.

The viewer now supports explicit height surfaces and physical stair transitions in both directions; arbitrary drops exceeding a normal step are blocked. Elevation is interpolated visually for a comfortable camera, without replacing the stair mesh with a flat floor. New source footage remains private and is not part of the Site checkout.
