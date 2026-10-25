# Validation record

## Passed locally
- Complete GLB parsed with the real Three.js 0.180.0 GLTFLoader: 206 meshes, 220,606 vertices; no bitmap shim needed.
- Recursive vendor graph includes three.module, three.core, GLTFLoader, BufferGeometryUtils, OrbitControls and SkeletonUtils. QA byte-compared vendored files to exact installed release and dynamically imported every entry.
- 10 Node tests: camera-relative movement at four cardinal yaws; normalized diagonals; repeated boundary/obstacle collision; frame-time clamp; mode-change pose preservation; pitch clamp; no movement without supplied floor; every actual zone view clear; every actual zone connected to arrival.
- Independent source review caught and fixed interrupted initialization/return, help-panel movement, blocked hack-zone viewpoint, context-restoration retry state, and fallback controls.
- Independent image review compared model renders with inspected actual video frames. Roof closure, transparent glazing and hero camera composition corrected after review.
- Original video and screenshots are outside Site checkout. Published asset tree contains reconstructed geometry and model-only renders, no people/badges/private footage.

## Not asserted
- Geometry is interpretive, not a measured survey. Full floorplan and actual local dimensions were not obtained. Official dimensions are separately attributed.
- Physical mobile touch/orientation behavior not runtime-tested; responsive CSS and movement/state logic reviewed.
- Local cloud-browser preview was unavailable (separate host, loopback connection refused). Public URL QA follows native deployment.
- Hardware WebGL performance cannot be inferred from offline GLB parsing or Blender renders.

## Revision v2 — entrance / merch
- Actual decoded references sampled across both additional clips, with full-resolution stair/landing/merch frames inspected privately.
- 16 tests pass. Added real-layout traversal from spawn through the long corridor and all seven .15m estimated risers, then exactly reversing to the original spawn; eight distinct floor-height levels observed. Merch view lies left of arrival axis and faces left. Camera now tracks floor elevation; >.25m instantaneous drops are blocked.
- Revised full GLB: 8,124,988 bytes, 239 meshes, 270,252 vertices, parsed with actual GLTFLoader.
- Ten safe zone viewpoints and continuous walking-plane connectivity verified; independent elevation-aware review passed: every stair tread raycast matches floorHeight and 26,755 reachable real-movement nodes connect all ten zones.
- Earlier cloud-browser WebGL limitation remains; no assertion of hardware/mobile rendering tests.
