// Shows the card the stage agent paid for on the main-stage backdrop of the ONE16 twin.
// Reads ./state/stage.json (written by agent/run.mjs). If the file or the backdrop node is missing,
// nothing changes: the venue keeps its default look.
//
// Pure helpers (cardText, screenPlacement, wrapLines) are exported for tests; THREE is passed in so
// this module never imports three.js itself.

export const BACKDROP_NODE = "Yellow event backdrop";

export function cardText(state) {
  const c = state?.card;
  if (!c || typeof c.title !== "string" || !c.title.trim()) return null;
  let when = "";
  if (c.start && !Number.isNaN(Date.parse(c.start))) {
    when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", weekday: "short", hour: "2-digit", minute: "2-digit" })
      .format(new Date(c.start));
  }
  return {
    label: String(c.label || "Next on the main stage").slice(0, 40),
    title: c.title.trim().slice(0, 120),
    when,
    location: String(c.location || "").slice(0, 60),
    paid: Boolean(state.tx),
  };
}

/**
 * Where to put the screen: on the face of the backdrop's bounding box that looks toward the
 * middle of the venue (where the audience is), slightly in front of it.
 * min/max/center are [x, y, z] in three.js world coordinates. Plane geometry faces +Z by default.
 */
export function screenPlacement(min, max, center) {
  const dx = max[0] - min[0], dy = max[1] - min[1], dz = max[2] - min[2];
  const thin = dx < dz ? 0 : 2; // the backdrop's thin horizontal axis is its normal
  const long = Math.max(dx, dz);
  const width = Math.min(long * 0.6, 8);
  const height = Math.min((width * 9) / 16, dy * 0.6);
  const mid = [(min[0] + max[0]) / 2, min[1] + dy * 0.55, (min[2] + max[2]) / 2];
  const dir = Math.sign(center[thin] - mid[thin]) || 1;
  const position = [...mid];
  position[thin] = (dir > 0 ? max[thin] : min[thin]) + dir * 0.03;
  const rotationY = thin === 2 ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  return { position, rotationY, width, height };
}

export function wrapLines(text, maxWidth, measure, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (measure(next) <= maxWidth || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  return lines;
}

export function drawCard(ctx, w, h, t) {
  ctx.fillStyle = "#07121f";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#72e3df";
  ctx.fillRect(0, 0, 14, h);
  const pad = 64;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#72e3df";
  ctx.font = "700 34px 'DM Sans', system-ui, sans-serif";
  ctx.fillText(t.label.toUpperCase(), pad, 56);
  ctx.fillStyle = "#eef4f7";
  ctx.font = "700 78px 'DM Sans', system-ui, sans-serif";
  const lines = wrapLines(t.title, w - pad * 2, (s) => ctx.measureText(s).width);
  lines.forEach((l, i) => ctx.fillText(l, pad, 120 + i * 90));
  ctx.fillStyle = "#90a8bb";
  ctx.font = "400 40px 'DM Sans', system-ui, sans-serif";
  ctx.fillText([t.when, t.location].filter(Boolean).join(" · "), pad, h - 140);
  if (t.paid) {
    ctx.fillStyle = "#e3bd79";
    ctx.font = "400 28px 'DM Sans', system-ui, sans-serif";
    ctx.fillText("Bought by the stage agent · testnet USDC over x402", pad, h - 80);
  }
}

export async function applyStageCard(THREE, model, { url = "./state/stage.json", fetchImpl = fetch } = {}) {
  let state;
  try {
    const r = await fetchImpl(url, { cache: "no-store" });
    if (!r.ok) return false;
    state = await r.json();
  } catch {
    return false;
  }
  const text = cardText(state);
  const backdrop = model?.getObjectByName?.(BACKDROP_NODE);
  if (!text || !backdrop) return false;

  const box = new THREE.Box3().setFromObject(backdrop);
  const venue = new THREE.Box3().setFromObject(model);
  const c = venue.getCenter(new THREE.Vector3());
  const p = screenPlacement(box.min.toArray(), box.max.toArray(), c.toArray());

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 576;
  drawCard(canvas.getContext("2d"), canvas.width, canvas.height, text);
  const texture = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(p.width, p.height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  screen.name = "Stage agent screen";
  screen.position.set(...p.position);
  screen.rotation.y = p.rotationY;
  model.add(screen);
  return true;
}
