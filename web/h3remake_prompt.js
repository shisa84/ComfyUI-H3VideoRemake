// Prompt editor for "H3 Remake · Prompt", modelled on Easy-Media's task segments and segment editor:
// general params (phase/resolutions/project folder/validation mode) on top, then a row of clips
// (each with its duration, valid flag and its own prompt); choosing one opens its editor with
// the six H3 sections as one text, A/B versions (the selected one is output), and clickable
// reference chips (<Picture N>, <Subject N>, <Audio N>) read from the Media Input wired to `data`,
// with those tags and the section headers highlighted. After a run, sections left empty are
// filled from data; "Fill from data" overwrites them with the latest data.
// The widget value is the JSON state read by nodes.py (H3RemakePrompt).
import { app } from "../../scripts/app.js";
import { baseName, subjectColor, viewUrl } from "./h3remake_media.js";

const NODE_NAME = "H3RemakePrompt";
const WIDGET_TYPE = "H3REMAKE_PROMPT_DATA";
const MEDIA_NODE = "H3RemakeMediaInput";
const SECTIONS = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];

const CSS = `
.h3p{display:flex;flex-direction:column;gap:6px;height:100%;min-height:0;box-sizing:border-box;padding:6px;
  font:12px/1.3 sans-serif;color:var(--fg-color,#ddd);background:rgba(0,0,0,.25);border-radius:6px;overflow:hidden}
.h3p *{box-sizing:border-box}
.h3p-bar{display:flex;align-items:center;justify-content:space-between;gap:6px;flex:0 0 auto}
.h3p-seg{display:flex;background:#1e1e1e;border-radius:6px;padding:2px}
.h3p-seg button{border:0;background:none;color:#999;font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer}
.h3p-seg button.on{background:#333;color:#6ab0ff}
.h3p-title{color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.h3p-general{display:flex;flex-wrap:wrap;gap:8px;align-items:center;flex:0 0 auto;font-size:11px;color:#999}
.h3p-general input[type=number]{width:52px;background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 4px;font-size:11px}
.h3p-general input[type=text]{flex:1;min-width:90px;background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 4px;font-size:11px}
.h3p-general select{background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 4px;font-size:11px}
.h3p-general .sep{color:#555}
.h3p-clips{display:flex;flex-wrap:wrap;gap:4px;flex:0 0 auto;max-height:70px;overflow-y:auto}
.h3p-clip{border:1px solid #444;border-left:4px solid #8a5cd0;border-radius:5px;background:#222;color:#ccc;font-size:11px;
  padding:4px 8px;cursor:pointer;white-space:nowrap}
.h3p-clip:hover{border-color:#888;border-left-color:#8a5cd0}
.h3p-clip.on{background:#3a2d52;color:#fff;border-color:#8a5cd0}
.h3p-clip.valid{border-left-color:#5fb878}
.h3p-add{border:1px dashed #666;border-radius:5px;background:none;color:#999;font-size:11px;padding:4px 8px;cursor:pointer}
.h3p-add:hover{border-color:#aaa;color:#ddd}
.h3p-clipbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:0 0 auto;border-top:1px dashed #444;padding-top:6px}
.h3p-valid{display:flex;align-items:center;gap:4px;color:#999;cursor:pointer}
.h3p-clipbar .name{font-weight:600;color:#c9a8f5}
.h3p-clipbar input{width:60px;background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:2px 4px;font-size:11px}
.h3p-icon{border:1px solid #444;border-radius:4px;background:#222;color:#ccc;font-size:11px;padding:2px 6px;cursor:pointer}
.h3p-icon:hover:not(:disabled){border-color:#888}
.h3p-icon:disabled{opacity:.35;cursor:default}
.h3p-icon.danger{color:#f08080}
.h3p-empty{flex:1;display:flex;align-items:center;justify-content:center;color:#888;font-size:12px;border:1px dashed #444;border-radius:6px}
.h3p-fill{border:1px solid #444;border-radius:5px;background:#222;color:#ccc;font-size:11px;padding:3px 8px;cursor:pointer}
.h3p-fill:hover:not(:disabled){border-color:#888}
.h3p-fill:disabled{opacity:.4;cursor:default}
.h3p-chips{display:flex;flex-wrap:wrap;gap:4px;flex:0 0 auto;max-height:90px;overflow-y:auto}
.h3p-chip{display:flex;align-items:center;gap:4px;border:1px solid #444;border-radius:5px;background:#222;color:#ddd;
  font-size:11px;padding:2px 6px 2px 2px;cursor:pointer}
.h3p-chip:hover{border-color:#888}
.h3p-chip img{width:22px;height:22px;object-fit:cover;border-radius:3px}
.h3p-chip .dot{width:10px;height:10px;border-radius:50%;margin-left:4px}
.h3p-hint{color:#888;font-size:11px}
.h3p-editor{position:relative;flex:1 1 auto;min-height:120px;background:#1b1b1b;border:1px solid #333;border-radius:6px;overflow:hidden}
.h3p-editor textarea,.h3p-editor .back{position:absolute;inset:0;margin:0;border:0;padding:8px;font:12px/1.5 ui-monospace,Consolas,monospace;
  white-space:pre-wrap;overflow-wrap:break-word;overflow-y:auto;scrollbar-gutter:stable;tab-size:4}
.h3p-editor textarea{resize:none;background:transparent;color:transparent;caret-color:#eee;outline:none}
.h3p-editor .back{color:#ccc;pointer-events:none;overflow-y:hidden}
.h3p-editor mark{background:none;border-radius:3px}
.h3p-editor mark.picture{color:#6ab0ff;background:rgba(106,176,255,.15)}
.h3p-editor mark.subject{color:#e0a060;background:rgba(224,160,96,.15)}
.h3p-editor mark.audio{color:#62d0a0;background:rgba(98,208,160,.15)}
.h3p-editor mark.shot{color:#c99af0}
.h3p-editor mark.header{color:#f0c85a}
`;

function injectStyle() {
  if (document.getElementById("h3remake-prompt-css")) return;
  const style = document.createElement("style");
  style.id = "h3remake-prompt-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TOKEN = new RegExp(`&lt;(Picture|Subject|Audio) \\d+&gt;|\\[Shot \\d+\\]|^(?:${SECTIONS.join("|")})\\s*:`, "gm");

function highlight(text) {
  // Same characters as the textarea, only wrapped in marks, so the caret stays aligned. The trailing
  // space keeps a final empty line the same height in both layers.
  return escapeHtml(text).replace(TOKEN, (token, kind) => {
    const cls = kind ? kind.toLowerCase() : token.startsWith("[") ? "shot" : "header";
    return `<mark class="${cls}">${token}</mark>`;
  }) + " ";
}

const HEADER = new RegExp(`^\\s*(${SECTIONS.join("|")})\\s*:\\s*(.*)$`);

// Same split as prompt_sections.split_sections: text before the first header counts as summary.
function splitSections(text) {
  const sections = {};
  let current = "summary";
  for (let line of text.split("\n")) {
    const match = line.match(HEADER);
    if (match) {
      current = match[1];
      sections[current] ??= [];
      line = match[2];
      if (!line) continue;
    }
    (sections[current] ??= []).push(line);
  }
  return Object.fromEntries(SECTIONS.map((name) => [name, (sections[name] ?? []).join("\n").trim()]));
}

const uid = () => Math.random().toString(36).slice(2, 10);
const DEFAULT_DURATION = 5; // seconds, about H3's 124-frame default
const newClip = (user) => ({ id: uid(), duration: DEFAULT_DURATION, variant: "a", user_a: user, user_b: "", valid: false });
const defaultGeneral = () => ({ aspect_ratio: "16:9 (Widescreen)", megapixels: 1.0, two_phase: false, upscale_megapixels: 4.0,
  project_folder: "", validation: "manual" });

// Same presets and formula as the core Resolution Selector node (comfy_extras/nodes_resolution.py).
const ASPECT_RATIOS = { "1:1 (Square)": [1, 1], "2:3 (Portrait Photo)": [2, 3], "3:2 (Photo)": [3, 2],
  "3:4 (Portrait Standard)": [3, 4], "4:3 (Standard)": [4, 3], "9:16 (Portrait Widescreen)": [9, 16],
  "16:9 (Widescreen)": [16, 9], "21:9 (Ultrawide)": [21, 9] };
const RESOLUTION_MULTIPLE = 32; // MiniMax H3's per-axis rounding (comfy_extras/nodes_minimax_h3.py)
function computeResolution(aspectRatio, megapixels) {
  const [wRatio, hRatio] = ASPECT_RATIOS[aspectRatio] ?? ASPECT_RATIOS["16:9 (Widescreen)"];
  const scale = Math.sqrt((megapixels * 1024 * 1024) / (wRatio * hRatio));
  const width = Math.round((wRatio * scale) / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE;
  const height = Math.round((hRatio * scale) / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE;
  return [width, height];
}

function segment(items, active, pick) {
  return el("div", { class: "h3p-seg" },
    items.map(([key, label]) => el("button", { class: key === active ? "on" : "", onclick: () => pick(key) }, label)));
}

const joinSections = (sections) => SECTIONS.map((name) => `${name}:\n${sections[name]}`.trimEnd()).join("\n\n") + "\n";

// The node feeding one of this node's inputs, if connected.
function linkOrigin(node, inputName) {
  const input = node.inputs?.find((i) => i.name === inputName);
  const graph = node.graph ?? app.graph;
  if (input?.link == null || !graph) return null;
  const link = graph.getLink?.(input.link) ?? graph.links?.get?.(input.link) ?? graph.links?.[input.link];
  return link ? graph.getNodeById(link.origin_id) : null;
}

// The Media Input node feeding `data`, if any: its picker state gives the chips, its last run the data.
function sourceMedia(node) {
  const origin = linkOrigin(node, "data");
  return origin?.type === MEDIA_NODE ? origin : null;
}

class PromptEditor {
  constructor(node, defaults) {
    this.node = node;
    this.defaults = defaults;
    this.state = { clips: [newClip(defaults.user)], selected: null, general: defaultGeneral() };
    this.latentIds = new Set(); // clip ids that actually have a saved latent on disk, from the last run
    this.root = el("div", { class: "h3p" });
    // Keep typing and scrolling inside the editor instead of the canvas.
    this.root.addEventListener("keydown", (e) => e.stopPropagation());
    this.root.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    this.data = null; // data sections from the last run
    this.onMediaChanged = () => this.renderChips();
    window.addEventListener("h3remake:media-changed", this.onMediaChanged);
    this.onData = (e) => { if (e.detail === sourceMedia(this.node)) this.receiveData(e.detail.h3remakeData); };
    window.addEventListener("h3remake:data", this.onData);
    // A connected Save Clip Latent runs after Prompt in the same queue, so Prompt can't see the save by
    // re-executing itself; it tells us directly instead (see h3remake_clip_latent.js).
    this.onLatentSaved = (e) => { if (linkOrigin(e.detail.node, "clip_index") === this.node) this.markClipIndexSaved(e.detail.clip_index); };
    window.addEventListener("h3remake:latent-saved", this.onLatentSaved);
    this.render();
  }

  get value() { return JSON.stringify(this.state); }

  load(value) {
    let data = {};
    try { data = typeof value === "string" ? JSON.parse(value || "{}") : value || {}; } catch { /* keep defaults */ }
    // A prompt saved before clips existed becomes the first clip.
    const clips = Array.isArray(data.clips) ? data.clips : "user_a" in data ? [{ ...newClip(""), ...data }] : [newClip(this.defaults.user)];
    this.state = {
      clips: clips.map((clip) => ({ ...newClip(this.defaults.user), ...clip, variant: clip.variant === "b" ? "b" : "a" })),
      selected: clips.some((clip) => clip.id === data.selected) ? data.selected : null,
      general: { ...defaultGeneral(), ...(data.general || {}) },
    };
    this.render();
  }

  get clip() { return this.state.clips.find((clip) => clip.id === this.state.selected) ?? null; }
  get clipIndex() { return this.state.clips.findIndex((clip) => clip.id === this.state.selected); }
  get textKey() { return this.clip?.variant === "b" ? "user_b" : "user_a"; }

  setText(text) {
    this.clip[this.textKey] = text;
    this.changed();
  }

  changed() { this.node.setDirtyCanvas?.(true, true); }

  // ---------- clips ----------
  selectClip(id) {
    this.state.selected = id;
    this.changed();
    this.render();
  }

  addClip(copyOf = null) {
    const clip = copyOf ? { ...copyOf, id: uid(), valid: false } : newClip(this.defaults.user);
    const at = copyOf ? this.clipIndex + 1 : this.state.clips.length;
    this.state.clips.splice(at, 0, clip);
    if (!copyOf && this.data) this.fillClip(clip, false);
    this.selectClip(clip.id);
  }

  moveClip(step) {
    const clips = this.state.clips, from = this.clipIndex, to = from + step;
    if (to < 0 || to >= clips.length) return;
    clips.splice(to, 0, clips.splice(from, 1)[0]);
    this.changed();
    this.render();
  }

  removeClip() {
    const at = this.clipIndex;
    this.state.clips.splice(at, 1);
    this.state.selected = this.state.clips[Math.min(at, this.state.clips.length - 1)]?.id ?? null;
    this.changed();
    this.render();
  }

  renderClips() {
    const blocks = this.state.clips.map((clip, i) => el("button", { class: `h3p-clip${clip.id === this.state.selected ? " on" : ""}${clip.valid ? " valid" : ""}`,
      title: "Edit this clip", onclick: () => this.selectClip(clip.id) }, `${clip.valid ? "✓ " : ""}Clip ${i + 1} · ${Number(clip.duration).toFixed(1)}s`));
    blocks.push(el("button", { class: "h3p-add", onclick: () => this.addClip() }, "+ Add clip"));
    return el("div", { class: "h3p-clips" }, blocks);
  }

  renderGeneral() {
    const g = this.state.general;
    const aspectSelect = el("select", { title: "Aspect ratio (same presets as the core Resolution Selector node)" },
      Object.keys(ASPECT_RATIOS).map((key) => el("option", { value: key, selected: g.aspect_ratio === key }, key)));
    aspectSelect.addEventListener("change", () => { g.aspect_ratio = aspectSelect.value; this.changed(); this.render(); });
    const mp = (key, title) => {
      const input = el("input", { type: "number", min: "0.1", max: "16", step: "0.1", value: g[key], title });
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (Number.isFinite(value) && value > 0) g[key] = value;
        this.changed();
        this.render();
      });
      return input;
    };
    const readout = (megapixels) => {
      const [w, h] = computeResolution(g.aspect_ratio, megapixels);
      return el("span", { class: "h3p-hint" }, `${w}×${h}`);
    };
    const phase = segment([["1", "1 phase"], ["2", "2 phase"]], g.two_phase ? "2" : "1", (key) => {
      g.two_phase = key === "2";
      this.changed();
      this.render();
    });
    const validation = segment([["manual", "Manual"], ["auto", "Auto"]], g.validation, (key) => {
      g.validation = key;
      this.changed();
    });
    const folder = el("input", { type: "text", placeholder: "project folder (under output/)", value: g.project_folder,
      title: "Where each clip's latent is saved/loaded (project_folder/clip_N.latent, under ComfyUI's output folder)." });
    folder.addEventListener("change", () => { g.project_folder = folder.value.trim(); this.changed(); });
    return el("div", { style: "display:flex;flex-direction:column;gap:4px;flex:0 0 auto" }, [
      el("div", { class: "h3p-general" }, [
        phase, el("span", { class: "sep" }, "|"),
        aspectSelect, mp("megapixels", "Base megapixels"), el("span", { class: "h3p-hint" }, "MP"), readout(g.megapixels),
        ...(g.two_phase ? [el("span", { class: "sep" }, "→"),
          mp("upscale_megapixels", "Upscale megapixels"), el("span", { class: "h3p-hint" }, "MP"), readout(g.upscale_megapixels)] : []),
      ]),
      el("div", { class: "h3p-general" }, [folder, validation]),
    ]);
  }

  renderClipBar() {
    const clip = this.clip, at = this.clipIndex, count = this.state.clips.length;
    const duration = el("input", { type: "number", min: "0.5", max: "60", step: "0.1", value: clip.duration, title: "Clip duration in seconds (24 fps)" });
    duration.addEventListener("change", () => {
      const seconds = Number(duration.value);
      clip.duration = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_DURATION;
      this.changed();
      this.render();
    });
    const hasLatent = this.latentIds.has(clip.id);
    const valid = el("input", { type: "checkbox", checked: clip.valid, disabled: !hasLatent,
      title: hasLatent ? "This clip's latent is trusted for the next clip's continuity (Manual validation mode)."
        : "Run the workflow with latent connected for this clip first (no saved latent for it yet)." });
    valid.addEventListener("change", () => { clip.valid = valid.checked; this.changed(); this.render(); });
    return el("div", { class: "h3p-clipbar" }, [
      el("span", { class: "name" }, `Clip ${at + 1}`),
      duration, el("span", { class: "h3p-hint" }, "s"),
      el("label", { class: "h3p-valid" }, [valid, "Valid"]),
      el("span", { style: "flex:1" }),
      el("button", { class: "h3p-icon", title: "Move left", disabled: at === 0, onclick: () => this.moveClip(-1) }, "◀"),
      el("button", { class: "h3p-icon", title: "Move right", disabled: at === count - 1, onclick: () => this.moveClip(1) }, "▶"),
      el("button", { class: "h3p-icon", title: "Duplicate this clip", onclick: () => this.addClip(clip) }, "Duplicate"),
      el("button", { class: "h3p-icon danger", title: "Delete this clip", onclick: () => this.removeClip() }, "Delete"),
    ]);
  }

  render() {
    const header = el("div", { class: "h3p-bar" }, [el("span", { class: "h3p-title" }, `Clips ${this.state.clips.length}`)]);
    const clip = this.clip;
    if (!clip) {
      this.chips = null;
      this.root.replaceChildren(header, this.renderGeneral(), this.renderClips(),
        el("div", { class: "h3p-empty" }, this.state.clips.length ? "Choose a clip to write its prompt." : "Add a clip to start."));
      return;
    }
    const variants = segment([["a", "A"], ["b", "B"]], clip.variant, (variant) => {
      // A fresh B starts as a copy of A, to be edited or compared.
      if (variant === "b" && !clip.user_b) clip.user_b = clip.user_a;
      clip.variant = variant;
      this.changed();
      this.render();
    });
    this.chips = el("div", { class: "h3p-chips" });
    this.back = el("div", { class: "back" });
    this.area = el("textarea", { spellcheck: "false" });
    this.area.value = clip[this.textKey];
    this.back.innerHTML = highlight(this.area.value);
    this.area.addEventListener("input", () => { this.setText(this.area.value); this.back.innerHTML = highlight(this.area.value); this.syncScroll(); });
    this.area.addEventListener("scroll", () => this.syncScroll());
    this.root.replaceChildren(
      header,
      this.renderGeneral(),
      this.renderClips(),
      this.renderClipBar(),
      el("div", { class: "h3p-bar" }, [
        el("span", { class: "h3p-title" }, "Prompt"),
        el("div", { style: "display:flex;gap:6px;align-items:center" }, [
          el("button", { class: "h3p-fill", disabled: !this.data, onclick: () => this.fill(true),
            title: this.data ? "Replace the sections with Media Input's latest data" : "Run the workflow once so Media Input produces data" }, "Fill from data"),
          variants,
        ]),
      ]),
      this.chips,
      el("div", { class: "h3p-editor" }, [this.back, this.area]),
    );
    this.renderChips();
  }

  syncScroll() { this.back.scrollTop = this.area.scrollTop; }

  // Copy data's sections into a clip's text: into its empty sections only (A and B), or over every section
  // data has content for in the version shown ("Fill from data").
  fillClip(clip, overwrite) {
    const keys = overwrite ? [clip.variant === "b" ? "user_b" : "user_a"] : ["user_a", "user_b"].filter((key) => clip[key]);
    for (const key of keys) {
      const sections = splitSections(clip[key]);
      let changed = false;
      for (const name of SECTIONS) {
        if (this.data[name] && (overwrite || !sections[name]) && sections[name] !== this.data[name]) {
          sections[name] = this.data[name];
          changed = true;
        }
      }
      if (changed) clip[key] = joinSections(sections);
    }
  }

  fill(overwrite) {
    this.fillClip(this.clip, overwrite);
    this.changed();
    this.render();
  }

  receiveData(data) {
    this.data = data;
    for (const clip of this.state.clips) this.fillClip(clip, false);
    this.changed();
    this.render();
  }

  receiveLatentIds(ids) {
    this.latentIds = new Set(ids);
    this.render();
  }

  markClipIndexSaved(clipIndex) {
    const clip = this.state.clips[clipIndex - 1];
    if (clip && !this.latentIds.has(clip.id)) {
      this.latentIds.add(clip.id);
      this.render();
    }
  }

  renderChips() {
    if (!this.chips?.isConnected) return;
    const media = sourceMedia(this.node)?.h3remakePicker?.state;
    if (!media) {
      this.chips.replaceChildren(el("span", { class: "h3p-hint" }, "Connect Media Input's data to insert its references."));
      return;
    }
    const activeAudios = media.audios.filter((a) => a.enabled !== false);
    const chips = [
      ...media.images.map((image, i) => el("button", { class: "h3p-chip", title: image.path, onclick: () => this.insert(`<Picture ${i + 1}>`) },
        [el("img", { src: viewUrl(image) }), `<Picture ${i + 1}>`])),
      ...media.subjects.map((subject, i) => el("button", { class: "h3p-chip", title: subject.kind, onclick: () => this.insert(`<Subject ${i + 1}>`) },
        [el("span", { class: "dot", style: `background:${subjectColor(i)}` }), `<Subject ${i + 1}> ${subject.kind}`])),
      ...activeAudios.map((audio, i) => el("button", { class: "h3p-chip", title: audio.path, onclick: () => this.insert(`<Audio ${i + 1}>`) },
        [`♪ <Audio ${i + 1}> ${baseName(audio.path)}`])),
    ];
    this.chips.replaceChildren(...(chips.length ? chips : [el("span", { class: "h3p-hint" }, "The connected Media Input has no media yet.")]));
  }

  insert(tag) {
    const { selectionStart: start, selectionEnd: end, value } = this.area;
    this.area.value = value.slice(0, start) + tag + value.slice(end);
    this.area.focus();
    this.area.selectionStart = this.area.selectionEnd = start + tag.length;
    this.area.dispatchEvent(new Event("input"));
  }

  // A newly connected Media Input that already ran hands over its data right away.
  connectionChanged() {
    const media = sourceMedia(this.node);
    if (media?.h3remakeData && media.h3remakeData !== this.data) this.receiveData(media.h3remakeData);
    else this.renderChips();
  }

  destroy() {
    window.removeEventListener("h3remake:media-changed", this.onMediaChanged);
    window.removeEventListener("h3remake:data", this.onData);
    window.removeEventListener("h3remake:latent-saved", this.onLatentSaved);
  }
}

app.registerExtension({
  name: "H3VideoRemake.Prompt",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.setSize([540, 660]);
    };
    // A narrower resize (e.g. grabbing the corner instead of the header while trying to move the node)
    // used to hide the clip bar's buttons entirely; keep a floor wide enough for them.
    const onResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      onResize?.apply(this, arguments);
      if (size[0] < 420) size[0] = 420;
    };
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      if (output?.h3remake_data?.[0]) this.h3remakePrompt?.receiveData(JSON.parse(output.h3remake_data[0]));
      if (output?.h3remake_latents?.[0]) this.h3remakePrompt?.receiveLatentIds(JSON.parse(output.h3remake_latents[0]));
    };
    const onConnectionsChange = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      onConnectionsChange?.apply(this, arguments);
      this.h3remakePrompt?.connectionChanged();
    };
    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      this.h3remakePrompt?.destroy();
      onRemoved?.apply(this, arguments);
    };
  },

  getCustomWidgets() {
    return {
      [WIDGET_TYPE](node, inputName, inputData) {
        injectStyle();
        const options = inputData?.[1] ?? {};
        const editor = new PromptEditor(node, { user: options.default_user_prompt ?? "" });
        node.h3remakePrompt = editor;
        const widget = node.addDOMWidget(inputName, WIDGET_TYPE, editor.root, {
          getValue: () => editor.value,
          setValue: (value) => editor.load(value),
          getMinHeight: () => 320,
          hideOnZoom: false,
          serialize: true,
        });
        widget.serializeValue = () => editor.value;
        // The Media Input may be configured after this node when a workflow loads.
        setTimeout(() => editor.renderChips(), 0);
        return { widget };
      },
    };
  },
});
