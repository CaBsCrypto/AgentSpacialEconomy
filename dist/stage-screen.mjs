// Shows the card the stage agent paid for on the main-stage backdrop of the ONE16 twin.
// Reads ./state/stage.json (written by agent/run.mjs). If the file or the backdrop node is missing,
// nothing changes: the venue keeps its default look.
//
// Pure helpers (cardText, screenPlacement, wrapLines) are exported for tests; THREE is passed in so
// this module never imports three.js itself.
//
// When ./state/screen.json holds a recorded four-section run (agent/screen-ci.mjs), the screen is
// split in four: each paid order shows in its section for five minutes and the sections rotate. A free
// section shows the host's card or offers itself for sale.
import { screenNow, validScreen, clock, SECTIONS } from "./screen-schedule.mjs";

// three.js GLTFLoader stores node names with spaces turned into "_" (PropertyBinding.sanitizeNodeName).
export const BACKDROP_NODE = "Yellow_event_backdrop";

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
    sponsor: sponsorLine(state.sponsor),
  };
}

/** "Presented by <name> · <message>" when a sponsor paid the venue treasury for this screen, else null. */
export function sponsorLine(sponsor) {
  if (!sponsor || !sponsor.tx || typeof sponsor.name !== "string" || !sponsor.name.trim()) return null;
  const message = typeof sponsor.message === "string" ? sponsor.message.trim() : "";
  return `${String(sponsor.label || "Presented by").slice(0, 20)} ${sponsor.name.trim().slice(0, 40)}${message ? ` · ${message.slice(0, 80)}` : ""}`;
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
  if (t.sponsor) {
    ctx.fillStyle = "#90a8bb";
    ctx.font = "400 24px 'DM Sans', system-ui, sans-serif";
    const [line] = wrapLines(t.sponsor, w - pad * 2, (s) => ctx.measureText(s).width, 1);
    ctx.fillText(line, pad, h - 40);
  }
}

const SECTION_COLORS = { A: "#f2d14b", B: "#72e3df", C: "#eef4f7", D: "#c9a6ff" };

/** Draw the four sections. view = screenNow(...); host = cardText(stage) or null. */
export function drawQuadrants(ctx, w, h, view, host = null) {
  const gap = 10, foot = 30;
  const cw = (w - gap * 3) / 2, ch = (h - foot - gap * 3) / 2;
  ctx.fillStyle = "#07121f";
  ctx.fillRect(0, 0, w, h);
  ctx.textBaseline = "top";
  let hostShown = false;
  SECTIONS.forEach((q, i) => {
    const x = gap + (i % 2) * (cw + gap), y = gap + Math.floor(i / 2) * (ch + gap);
    const sec = view.sections[q];
    const fit = (text, size, weight, maxLines) => {
      ctx.font = `${weight} ${size}px 'DM Sans', system-ui, sans-serif`;
      return wrapLines(text, cw - 40, (s) => ctx.measureText(s).width, maxLines);
    };
    if (sec.current) {
      const o = sec.current;
      ctx.fillStyle = SECTION_COLORS[q];
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#07121f";
      ctx.font = "700 16px 'DM Sans', system-ui, sans-serif";
      ctx.fillText(`SECTION ${q} · PAID ${Number(o.priceUsdc ?? 5)} USDC (TESTNET)`, x + 20, y + 16);
      fit(o.advertiser, 34, 700, 2).forEach((l, n) => { ctx.font = "700 34px 'DM Sans', system-ui, sans-serif"; ctx.fillText(l, x + 20, y + 44 + n * 38); });
      fit(o.headline || "", 22, 400, 2).forEach((l, n) => { ctx.font = "400 22px 'DM Sans', system-ui, sans-serif"; ctx.fillText(l, x + 20, y + 126 + n * 26); });
      ctx.font = "400 16px 'DM Sans', system-ui, sans-serif";
      ctx.fillText(`${clock(sec.remainingMs)} left${sec.next ? ` · next: ${sec.next.advertiser}` : ""}`, x + 20, y + ch - 30);
    } else if (host && !hostShown) {
      hostShown = true;
      ctx.fillStyle = "#102742";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#72e3df";
      ctx.font = "700 16px 'DM Sans', system-ui, sans-serif";
      ctx.fillText(`SECTION ${q} · HOST · ${String(host.label).toUpperCase()}`, x + 20, y + 16);
      ctx.fillStyle = "#eef4f7";
      fit(host.title, 34, 700, 2).forEach((l, n) => { ctx.font = "700 34px 'DM Sans', system-ui, sans-serif"; ctx.fillText(l, x + 20, y + 44 + n * 38); });
      ctx.fillStyle = "#90a8bb";
      ctx.font = "400 18px 'DM Sans', system-ui, sans-serif";
      ctx.fillText([host.when, host.location].filter(Boolean).join(" · "), x + 20, y + ch - 30);
    } else {
      ctx.fillStyle = "#0b1b2e";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#e3bd79";
      ctx.font = "700 16px 'DM Sans', system-ui, sans-serif";
      ctx.fillText(`SECTION ${q} · AVAILABLE`, x + 20, y + 16);
      ctx.fillStyle = "#eef4f7";
      ctx.font = "700 30px 'DM Sans', system-ui, sans-serif";
      ctx.fillText("Your project here", x + 20, y + 48);
      ctx.fillStyle = "#e3bd79";
      ctx.font = "400 22px 'DM Sans', system-ui, sans-serif";
      ctx.fillText("5 USDC · 5 min · x402 (testnet)", x + 20, y + 92);
      if (sec.next) {
        ctx.fillStyle = "#90a8bb";
        ctx.font = "400 16px 'DM Sans', system-ui, sans-serif";
        ctx.fillText(`next: ${sec.next.advertiser}`, x + 20, y + ch - 30);
      }
    }
  });
  ctx.fillStyle = "#90a8bb";
  ctx.font = "400 15px 'DM Sans', system-ui, sans-serif";
  const label = view.mode === "replay" ? "Recorded testnet orders · replay" : view.mode === "upcoming" ? "Recorded testnet orders · starting soon" : "Testnet orders · live";
  ctx.fillText(`${label} · each section: 5 USDC for 5 min, paid to the venue over x402`, gap, h - foot + 8);
}

async function readJson(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function applyStageCard(THREE, model, { url = "./state/stage.json", screenUrl = "./state/screen.json", fetchImpl = fetch } = {}) {
  const [state, screenState] = await Promise.all([readJson(fetchImpl, url), readJson(fetchImpl, screenUrl)]);
  if (!state && !screenState) return false;
  const text = state ? cardText(state) : null;
  const split = validScreen(screenState);
  if (!text && !split) return false;
  const backdrop = model?.getObjectByName?.(BACKDROP_NODE);
  if (!backdrop) return false;

  const box = new THREE.Box3().setFromObject(backdrop);
  const venue = new THREE.Box3().setFromObject(model);
  const c = venue.getCenter(new THREE.Vector3());
  const p = screenPlacement(box.min.toArray(), box.max.toArray(), c.toArray());

  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext("2d");
  const draw = () => (split ? drawQuadrants(ctx, canvas.width, canvas.height, screenNow(screenState), text) : drawCard(ctx, canvas.width, canvas.height, text));
  draw();
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
  if (split && typeof setInterval === "function") {
    // Rotate the sections and count down once a second.
    const timer = setInterval(() => { draw(); texture.needsUpdate = true; }, 1000);
    timer?.unref?.();
  }
  return true;
}
