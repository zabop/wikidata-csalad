// Pedigree viewer: draws a few generations around the selected person only,
// so large GEDCOM files stay fast.
const BOX_W = 210;
const BOX_H = 46;
const COL_GAP = 46;
const ROW_GAP = 10;

const state = { data: null, current: null, history: [], future: [], searchIndex: [], rootPath: {} };
const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

function yearOf(date) {
  if (!date) return "";
  const m = date.match(/(\d{3,4})\s*$/);
  if (!m) return "";
  return (/^(ABT|EST|CAL)/.test(date) ? "c. " : "") + m[1];
}
function lifespan(p) {
  const b = yearOf(p.birth.date);
  const d = yearOf(p.death.date);
  if (!b && !d) return "";
  return `${b || "?"} – ${d || ""}`.trim();
}
function parentsOf(id) {
  const p = state.data.people[id];
  if (!p || !p.famc.length) return [null, null];
  const f = state.data.families[p.famc[0]];
  return f ? [f.husb, f.wife] : [null, null];
}
function spousesAndChildren(id) {
  const p = state.data.people[id];
  return p.fams.map((fid) => {
    const f = state.data.families[fid];
    const spouse = f.husb === id ? f.wife : f.husb;
    return { spouse, children: f.chil };
  });
}

// For every ancestor of the root, remember which child leads back towards the root.
function buildRootPaths() {
  const root = state.data.root;
  const next = { [root]: null };
  const queue = [root];
  while (queue.length) {
    const id = queue.shift();
    for (const par of parentsOf(id)) {
      if (par && !(par in next)) { next[par] = id; queue.push(par); }
    }
  }
  state.rootPath = next;
}
function pathFromRoot(id) {
  if (!(id in state.rootPath)) return null;
  const chain = [];
  for (let x = id; x; x = state.rootPath[x]) chain.push(x);
  return chain.reverse(); // root first
}

function el(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function fitText(text, max) {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function drawChart() {
  const svg = $("chart");
  svg.replaceChildren();
  const gens = Number($("gens").value);
  const slots = 2 ** (gens - 1);
  const height = slots * (BOX_H + ROW_GAP);
  const width = gens * (BOX_W + COL_GAP);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const links = el("g");
  const boxes = el("g");
  svg.append(links, boxes);

  // gen 0 = current person; each generation doubles the slots
  let level = [state.current];
  for (let g = 0; g < gens; g++) {
    const n = 2 ** g;
    const slotH = height / n;
    const x = g * (BOX_W + COL_GAP);
    const nextLevel = [];
    level.forEach((id, i) => {
      const [fa, mo] = id ? parentsOf(id) : [null, null];
      if (g < gens - 1) nextLevel.push(fa, mo);
      if (!id) return;
      const p = state.data.people[id];
      const cy = slotH * (i + 0.5);
      const y = cy - BOX_H / 2;

      const box = el("g", { class: `box ${p.sex || "U"}${id === state.current ? " focus" : ""}`, transform: `translate(${x},${y})` });
      box.append(el("rect", { width: BOX_W, height: BOX_H, rx: 6 }));
      box.append(el("text", { x: 10, y: 19, "font-size": 13, "font-weight": 600 }, fitText(p.name || "(no name)", 28)));
      box.append(el("text", { x: 10, y: 36, class: "years" }, lifespan(p)));
      const title = el("title", {}, `${p.name}${lifespan(p) ? " (" + lifespan(p) + ")" : ""}`);
      box.append(title);
      box.addEventListener("click", () => select(id));
      boxes.append(box);

      if (g === gens - 1 && (fa || mo)) {
        box.append(el("text", { x: BOX_W - 16, y: 29, class: "more" }, "›"));
      }
      if (g < gens - 1) {
        const childSlotH = height / (n * 2);
        [fa, mo].forEach((par, k) => {
          if (!par) return;
          const py = childSlotH * (i * 2 + k + 0.5);
          const x1 = x + BOX_W;
          const x2 = x + BOX_W + COL_GAP;
          const mx = x1 + COL_GAP / 2;
          links.append(el("path", { class: "link", d: `M${x1},${cy} H${mx} V${py} H${x2}` }));
        });
      }
    });
    level = nextLevel;
  }
}

function personLink(id) {
  const p = state.data.people[id];
  const a = document.createElement("span");
  a.className = "person-link";
  a.textContent = p ? p.name || "(no name)" : "unknown";
  if (p) a.addEventListener("click", () => select(id));
  return a;
}
function section(title) {
  const h = document.createElement("h3");
  h.textContent = title;
  return h;
}
function listOf(ids, extra) {
  const ul = document.createElement("ul");
  ids.filter(Boolean).forEach((id) => {
    const li = document.createElement("li");
    li.append(personLink(id));
    const span = lifespan(state.data.people[id]);
    if (span) li.append(` (${span})`);
    if (extra) extra(li, id);
    ul.append(li);
  });
  return ul;
}

// Plain-text version of a line from the root: one person per row with their sources.
function lineText(chain) {
  const rows = chain.map((x, i) => {
    const p = state.data.people[x];
    const span = lifespan(p);
    const notes = p.notes.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean);
    const lines = [];
    if (p.refn && /^Q\d+$/.test(p.refn)) {
      const url = `https://www.wikidata.org/wiki/${p.refn}`;
      if (!notes.some((n) => n.includes(url))) lines.push(`Wikidata: ${url}`);
    }
    lines.push(...notes);
    return `${i}. ${p.name || "(no name)"}${span ? ` (${span})` : ""}` +
      lines.map((l) => `\n   ${l}`).join("");
  });
  const last = state.data.people[chain[chain.length - 1]];
  return `Line from start to ${last.name} (${chain.length - 1} generations)\n\n${rows.join("\n")}\n`;
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback for browsers that block the async clipboard API
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function drawDetails() {
  const id = state.current;
  const p = state.data.people[id];
  const box = $("details");
  box.replaceChildren();

  const h = document.createElement("h2");
  h.textContent = p.name || "(no name)";
  box.append(h);

  const facts = document.createElement("div");
  facts.className = "facts";
  const addFact = (label, ev) => {
    if (!ev.date && !ev.place) return;
    const d = document.createElement("div");
    d.textContent = `${label}: ${[ev.date, ev.place].filter(Boolean).join(", ")}`;
    facts.append(d);
  };
  addFact("Born", p.birth);
  addFact("Died", p.death);
  if (p.refn && /^Q\d+$/.test(p.refn)) {
    const d = document.createElement("div");
    const a = document.createElement("a");
    a.href = `https://www.wikidata.org/wiki/${p.refn}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = `Wikidata ${p.refn}`;
    d.append(a);
    facts.append(d);
  }
  box.append(facts);

  const [fa, mo] = parentsOf(id);
  if (fa || mo) { box.append(section("Parents")); box.append(listOf([fa, mo])); }

  const fams = spousesAndChildren(id);
  fams.forEach(({ spouse, children }) => {
    box.append(section(spouse ? "Spouse & children" : "Children"));
    if (spouse) box.append(listOf([spouse]));
    if (children.length) box.append(listOf(children));
  });

  const chain = pathFromRoot(id);
  if (chain && chain.length > 1) {
    const head = section(`Line from start (${chain.length - 1} generations)`);
    const copy = document.createElement("button");
    copy.className = "copy-line";
    copy.textContent = "Copy";
    copy.title = "Copy this line, one person per row, with source links";
    copy.addEventListener("click", async () => {
      const ok = await copyText(lineText(chain));
      copy.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    });
    head.append(copy);
    box.append(head);
    const div = document.createElement("div");
    div.className = "path";
    chain.forEach((x, i) => {
      if (i) div.append(" → ");
      div.append(personLink(x));
    });
    box.append(div);
  }

  if (p.notes.length) {
    box.append(section("Notes & sources"));
    p.notes.forEach((n) => {
      const d = document.createElement("div");
      d.className = "note";
      d.textContent = n;
      box.append(d);
    });
  }
}

function select(id, { record = true, fromOverview = false } = {}) {
  if (!id || !state.data.people[id]) return;
  if (record && state.current && state.current !== id) {
    state.history.push(state.current);
    state.future = [];
  }
  state.current = id;
  location.hash = id.replace(/@/g, "");
  drawDetails();
  $("back").disabled = !state.history.length;
  $("forward").disabled = !state.future.length;
  if (state.view === "overview") {
    ovHighlight(id);
    if (!fromOverview) ovCenterOn(id);
    ovDraw();
  } else {
    drawChart();
    centerChart();
  }
}

// ------------------------------------------------------------------ overview
// Every ancestor of the base person drawn once, one column per generation.
const OV = { COL_W: 230, BOX_W: 190, BOX_H: 20, ROW_H: 26 };

function ovBuild(baseId) {
  const gen = new Map([[baseId, 0]]);
  const toBase = new Map([[baseId, null]]); // child on the shortest line back to base
  const queue = [baseId];
  while (queue.length) {
    const id = queue.shift();
    for (const par of parentsOf(id)) {
      if (par && !gen.has(par)) { gen.set(par, gen.get(id) + 1); toBase.set(par, id); queue.push(par); }
    }
  }
  const childrenOf = new Map();
  const edges = [];
  for (const id of gen.keys()) {
    for (const par of parentsOf(id)) {
      if (!par || !gen.has(par)) continue;
      edges.push([id, par]);
      if (!childrenOf.has(par)) childrenOf.set(par, []);
      childrenOf.get(par).push(id);
    }
  }
  const maxGen = Math.max(...gen.values());
  const cols = Array.from({ length: maxGen + 1 }, () => []);
  for (const [id, g] of gen) cols[g].push(id);

  // Order each column by the average position of the person's children (fewer crossings).
  const pos = new Map();
  const place = (col, g) => {
    col.forEach((id, i) => pos.set(id, { x: g * OV.COL_W, y: (i - (col.length - 1) / 2) * OV.ROW_H, gen: g }));
  };
  place(cols[0], 0);
  for (let g = 1; g <= maxGen; g++) {
    const key = new Map();
    cols[g].forEach((id, i) => {
      const ys = (childrenOf.get(id) || []).map((c) => pos.get(c)).filter(Boolean).map((p) => p.y);
      const sex = state.data.people[id].sex === "F" ? 0.1 : 0;
      key.set(id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length + sex : i * 1e-6);
    });
    cols[g].sort((a, b) => key.get(a) - key.get(b));
    place(cols[g], g);
  }
  const maxRows = Math.max(...cols.map((c) => c.length));
  state.ov = {
    base: baseId, pos, cols, edges, toBase, maxGen,
    width: (maxGen + 1) * OV.COL_W, height: maxRows * OV.ROW_H,
    scale: 1, tx: 0, ty: 0, highlight: new Set(), hover: null,
  };
  $("stats").textContent = `${state.data.file}: ${(gen.size - 1).toLocaleString()} ancestors in ${maxGen} generations`;
}

function ovCanvasSize() {
  const c = $("overview");
  const wrap = $("chart-wrap");
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(wrap.clientWidth * dpr);
  c.height = Math.round(wrap.clientHeight * dpr);
  return { w: wrap.clientWidth, h: wrap.clientHeight, dpr };
}

function ovFit() {
  const ov = state.ov;
  const { w, h } = ovCanvasSize();
  ov.scale = Math.min(w / (ov.width + 40), h / (ov.height + 40));
  ov.tx = (w - ov.width * ov.scale) / 2 + 20 * ov.scale;
  ov.ty = h / 2;
  ovDraw();
}

function ovCenterOn(id) {
  const ov = state.ov;
  const p = ov && ov.pos.get(id);
  if (!p) return;
  const { w, h } = ovCanvasSize();
  ov.scale = Math.max(ov.scale, 0.8);
  ov.tx = w / 2 - (p.x + OV.BOX_W / 2) * ov.scale;
  ov.ty = h / 2 - p.y * ov.scale;
}

function ovHighlight(id) {
  const ov = state.ov;
  ov.highlight = new Set();
  for (let x = id; x && ov.toBase.has(x); x = ov.toBase.get(x)) ov.highlight.add(x);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ovDraw() {
  const ov = state.ov;
  if (!ov || state.view !== "overview") return;
  const c = $("overview");
  const { w, h, dpr } = ovCanvasSize();
  const ctx = c.getContext("2d");
  const col = {
    bg: cssVar("--bg"), line: cssVar("--line"), focus: cssVar("--focus"), text: cssVar("--text"),
    M: [cssVar("--male"), cssVar("--male-edge")], F: [cssVar("--female"), cssVar("--female-edge")], U: [cssVar("--unknown"), cssVar("--unknown-edge")],
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = col.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * ov.scale, 0, 0, dpr * ov.scale, dpr * ov.tx, dpr * ov.ty);

  // visible world rectangle, for culling
  const x0 = -ov.tx / ov.scale - OV.COL_W, x1 = (w - ov.tx) / ov.scale + OV.COL_W;
  const y0 = -ov.ty / ov.scale - OV.ROW_H, y1 = (h - ov.ty) / ov.scale + OV.ROW_H;
  const visible = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;

  const drawEdge = (a, b) => {
    const xa = a.x + OV.BOX_W, xb = b.x, mx = (xa + xb) / 2;
    ctx.moveTo(xa, a.y);
    ctx.bezierCurveTo(mx, a.y, mx, b.y, xb, b.y);
  };
  ctx.lineWidth = 1 / Math.max(ov.scale, 0.35);
  ctx.strokeStyle = col.line;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  const hiEdges = [];
  for (const [cId, pId] of ov.edges) {
    const a = ov.pos.get(cId), b = ov.pos.get(pId);
    if (Math.max(a.x, b.x) < x0 || Math.min(a.x, b.x) > x1) continue;
    if (Math.max(a.y, b.y) < y0 || Math.min(a.y, b.y) > y1) continue;
    if (ov.highlight.has(cId) && ov.highlight.has(pId) && ov.toBase.get(pId) === cId) { hiEdges.push([a, b]); continue; }
    drawEdge(a, b);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (hiEdges.length) {
    ctx.strokeStyle = col.focus;
    ctx.lineWidth = 3 / Math.max(ov.scale, 0.35);
    ctx.beginPath();
    hiEdges.forEach(([a, b]) => drawEdge(a, b));
    ctx.stroke();
  }

  const showText = ov.scale >= 0.45;
  ctx.font = "600 12px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  for (const [id, p] of ov.pos) {
    if (!visible(p)) continue;
    const person = state.data.people[id];
    const [fill, edge] = col[person.sex] || col.U;
    const hi = ov.highlight.has(id);
    ctx.fillStyle = fill;
    ctx.strokeStyle = id === state.current || id === ov.hover ? col.focus : edge;
    ctx.lineWidth = (hi || id === ov.hover ? 2.5 : 1) / Math.max(ov.scale, 0.35);
    ctx.beginPath();
    ctx.roundRect(p.x, p.y - OV.BOX_H / 2, OV.BOX_W, OV.BOX_H, 4);
    ctx.fill();
    ctx.stroke();
    if (showText) {
      ctx.fillStyle = col.text;
      const span = lifespan(person);
      ctx.fillText(fitText(person.name || "(no name)", span ? 20 : 27) + (span ? `  ${span}` : ""), p.x + 6, p.y, OV.BOX_W - 10);
    }
  }
  // generation labels along the top
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = col.line;
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  for (let g = 0; g <= ov.maxGen; g++) {
    const sx = (g * OV.COL_W + OV.BOX_W / 2) * ov.scale + ov.tx;
    if (sx > -40 && sx < w + 40 && OV.COL_W * ov.scale > 26) ctx.fillText(g === 0 ? "start" : `gen ${g}`, sx - 14, 14);
  }
}

function ovHit(clientX, clientY) {
  const ov = state.ov;
  const r = $("overview").getBoundingClientRect();
  const wx = (clientX - r.left - ov.tx) / ov.scale;
  const wy = (clientY - r.top - ov.ty) / ov.scale;
  const g = Math.floor(wx / OV.COL_W);
  if (g < 0 || g > ov.maxGen || wx - g * OV.COL_W > OV.BOX_W) return null;
  const col = ov.cols[g];
  const i = Math.round(wy / OV.ROW_H + (col.length - 1) / 2);
  const id = col[i];
  if (!id) return null;
  return Math.abs(ov.pos.get(id).y - wy) <= OV.BOX_H / 2 ? id : null;
}

function setupOverview() {
  const c = $("overview");
  const tip = $("ov-tooltip");
  let drag = null;
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    const ov = state.ov;
    const r = c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    const ns = Math.min(3, Math.max(0.01, ov.scale * k));
    ov.tx = mx - (mx - ov.tx) * (ns / ov.scale);
    ov.ty = my - (my - ov.ty) * (ns / ov.scale);
    ov.scale = ns;
    ovDraw();
  }, { passive: false });
  c.addEventListener("mousedown", (e) => {
    drag = { x: e.clientX, y: e.clientY, tx: state.ov.tx, ty: state.ov.ty, moved: false };
    c.classList.add("dragging");
  });
  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    c.classList.remove("dragging");
    const wasClick = !drag.moved;
    drag = null;
    if (wasClick && e.target === c) {
      const id = ovHit(e.clientX, e.clientY);
      if (id) select(id, { fromOverview: true });
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (state.view !== "overview") return;
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      state.ov.tx = drag.tx + dx;
      state.ov.ty = drag.ty + dy;
      ovDraw();
      return;
    }
    if (e.target !== c) return;
    const id = ovHit(e.clientX, e.clientY);
    if (id !== state.ov.hover) { state.ov.hover = id; ovDraw(); }
    if (id) {
      const p = state.data.people[id];
      const r = $("chart-wrap").getBoundingClientRect();
      tip.textContent = `${p.name}${lifespan(p) ? " (" + lifespan(p) + ")" : ""} · generation ${state.ov.pos.get(id).gen}`;
      tip.style.left = `${e.clientX - r.left + 14}px`;
      tip.style.top = `${e.clientY - r.top + 14}px`;
      tip.hidden = false;
    } else {
      tip.hidden = true;
    }
  });
  c.addEventListener("mouseleave", () => { tip.hidden = true; });
  c.addEventListener("dblclick", (e) => {
    const id = ovHit(e.clientX, e.clientY);
    if (id) { setView("pedigree"); select(id); }
  });
  $("ov-fit").addEventListener("click", ovFit);
  window.addEventListener("resize", () => ovDraw());
}

function setView(view) {
  state.view = view;
  $("view-pedigree").classList.toggle("active", view === "pedigree");
  $("view-overview").classList.toggle("active", view === "overview");
  $("chart-wrap").classList.toggle("overview", view === "overview");
  $("gens-label").hidden = view === "overview";
  if (view === "overview") {
    if (!state.ov || state.ov.base !== state.current) ovBuild(state.current);
    ovHighlight(state.current);
    ovFit();
  } else {
    $("stats").textContent = `${state.data.file}: ${Object.keys(state.data.people).length.toLocaleString()} people`;
    drawChart();
    centerChart();
  }
}

// Scroll so the selected person (left column, vertical middle) is in view.
function centerChart() {
  const wrap = $("chart-wrap");
  wrap.scrollTo({ left: 0, top: Math.max(0, ($("chart").clientHeight - wrap.clientHeight) / 2 + 16) });
}

function setupSearch() {
  state.searchIndex = Object.values(state.data.people).map((p) => ({
    id: p.id,
    key: (p.name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(),
  }));
  const input = $("search");
  const results = $("results");
  let active = -1;
  const render = () => {
    const q = input.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    results.replaceChildren();
    active = -1;
    if (q.length < 2) { results.hidden = true; return; }
    const words = q.split(/\s+/);
    const hits = state.searchIndex.filter((e) => words.every((w) => e.key.includes(w))).slice(0, 50);
    hits.forEach(({ id }) => {
      const p = state.data.people[id];
      const li = document.createElement("li");
      li.textContent = p.name;
      const s = document.createElement("small");
      s.textContent = lifespan(p);
      li.append(s);
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(id); });
      results.append(li);
    });
    results.hidden = !hits.length;
  };
  const choose = (id) => { results.hidden = true; input.value = ""; select(id); };
  input.addEventListener("input", render);
  input.addEventListener("blur", () => { results.hidden = true; });
  input.addEventListener("keydown", (e) => {
    const items = [...results.children];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Enter" && items.length) {
      items[Math.max(active, 0)].dispatchEvent(new MouseEvent("mousedown"));
    } else if (e.key === "Escape") {
      results.hidden = true;
    }
  });
}

// GEDCOM files published next to the page; the first is shown by default.
const GED_FILES = ["ancestors_pre1930.ged", "ancestors_pre1930_only_referenced_parent_links.ged"];

async function init() {
  const params = new URLSearchParams(location.search);
  const file = GED_FILES.includes(params.get("file")) ? params.get("file") : GED_FILES[0];
  const res = await fetch(file);
  if (!res.ok) { $("details").textContent = `Could not load ${file} (HTTP ${res.status})`; return; }
  state.data = { file, files: GED_FILES, ...parseGedcom(await res.text()) };
  const picker = $("file-select");
  state.data.files.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f;
    opt.selected = f === state.data.file;
    picker.append(opt);
  });
  picker.addEventListener("change", () => {
    const next = new URLSearchParams(location.search);
    next.set("file", picker.value);
    location.href = `${location.pathname}?${next.toString()}`; // fresh load: person ids differ between files
  });
  buildRootPaths();
  setupSearch();
  $("stats").textContent = `${state.data.file}: ${Object.keys(state.data.people).length.toLocaleString()} people`;
  $("gens").addEventListener("change", () => { drawChart(); centerChart(); });
  state.view = "pedigree";
  setupOverview();
  $("view-pedigree").addEventListener("click", () => setView("pedigree"));
  $("view-overview").addEventListener("click", () => setView("overview"));
  $("home").addEventListener("click", () => select(state.data.root));
  $("back").addEventListener("click", () => {
    if (!state.history.length) return;
    state.future.push(state.current);
    select(state.history.pop(), { record: false });
  });
  $("forward").addEventListener("click", () => {
    if (!state.future.length) return;
    state.history.push(state.current);
    select(state.future.pop(), { record: false });
  });
  const fromHash = location.hash.slice(1);
  select(fromHash && state.data.people[`@${fromHash}@`] ? `@${fromHash}@` : state.data.root, { record: false });
}

init();
