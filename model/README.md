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
