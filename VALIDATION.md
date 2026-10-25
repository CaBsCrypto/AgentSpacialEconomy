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
