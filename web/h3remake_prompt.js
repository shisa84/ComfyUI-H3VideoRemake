// Prompt editor for "H3 Remake · Prompt", modelled on Easy-Media's segment prompt editor:
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

const joinSections = (sections) => SECTIONS.map((name) => `${name}:\n${sections[name]}`.trimEnd()).join("\n\n") + "\n";

// The Media Input node feeding `data`, if any: its picker state gives the chips, its last run the data.
function sourceMedia(node) {
  const input = node.inputs?.find((i) => i.name === "data");
  const graph = node.graph ?? app.graph;
  if (input?.link == null || !graph) return null;
  const link = graph.getLink?.(input.link) ?? graph.links?.get?.(input.link) ?? graph.links?.[input.link];
  const origin = link ? graph.getNodeById(link.origin_id) : null;
  return origin?.type === MEDIA_NODE ? origin : null;
}

class PromptEditor {
  constructor(node, defaults) {
    this.node = node;
    this.defaults = defaults;
    this.state = { variant: "a", user_a: defaults.user, user_b: "" };
    this.root = el("div", { class: "h3p" });
    // Keep typing and scrolling inside the editor instead of the canvas.
    this.root.addEventListener("keydown", (e) => e.stopPropagation());
    this.root.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    this.data = null; // data sections from the last run
    this.onMediaChanged = () => this.renderChips();
    window.addEventListener("h3remake:media-changed", this.onMediaChanged);
    this.onData = (e) => { if (e.detail === sourceMedia(this.node)) this.receiveData(e.detail.h3remakeData); };
    window.addEventListener("h3remake:data", this.onData);
    this.render();
  }

  get value() { return JSON.stringify(this.state); }

  load(value) {
    try {
      const data = typeof value === "string" ? JSON.parse(value || "{}") : value || {};
      this.state = {
        variant: data.variant === "b" ? "b" : "a",
        user_a: typeof data.user_a === "string" ? data.user_a : this.defaults.user,
        user_b: typeof data.user_b === "string" ? data.user_b : "",
      };
    } catch {
      this.state = { variant: "a", user_a: this.defaults.user, user_b: "" };
    }
    this.render();
  }

  get textKey() { return this.state.variant === "b" ? "user_b" : "user_a"; }

  setText(text) {
    this.state[this.textKey] = text;
    this.node.setDirtyCanvas?.(true, true);
  }

  render() {
    const segment = (items, active, pick) => el("div", { class: "h3p-seg" },
      items.map(([key, label]) => el("button", { class: key === active ? "on" : "", onclick: () => pick(key) }, label)));
    const variants = segment([["a", "A"], ["b", "B"]], this.state.variant, (variant) => {
      // A fresh B starts as a copy of A, to be edited or compared.
      if (variant === "b" && !this.state.user_b) this.state.user_b = this.state.user_a;
      this.state.variant = variant;
      this.node.setDirtyCanvas?.(true, true);
      this.render();
    });
    this.chips = el("div", { class: "h3p-chips" });
    this.back = el("div", { class: "back" });
    this.area = el("textarea", { spellcheck: "false" });
    this.area.value = this.state[this.textKey];
    this.back.innerHTML = highlight(this.area.value);
    this.area.addEventListener("input", () => { this.setText(this.area.value); this.back.innerHTML = highlight(this.area.value); this.syncScroll(); });
    this.area.addEventListener("scroll", () => this.syncScroll());
    this.root.replaceChildren(
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

  // Copy data's sections into the text: into empty sections only (after a run), or over every section
  // data has content for ("Fill from data").
  fill(overwrite) {
    const keys = overwrite ? [this.textKey] : ["user_a", "user_b"].filter((key) => this.state[key]);
    for (const key of keys) {
      const sections = splitSections(this.state[key]);
      let changed = false;
      for (const name of SECTIONS) {
        if (this.data[name] && (overwrite || !sections[name]) && sections[name] !== this.data[name]) {
          sections[name] = this.data[name];
          changed = true;
        }
      }
      if (changed) this.state[key] = joinSections(sections);
    }
    this.node.setDirtyCanvas?.(true, true);
    this.render();
  }

  receiveData(data) {
    this.data = data;
    this.fill(false);
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
  }
}

app.registerExtension({
  name: "H3VideoRemake.Prompt",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.setSize([520, 520]);
    };
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      if (output?.h3remake_data?.[0]) this.h3remakePrompt?.receiveData(JSON.parse(output.h3remake_data[0]));
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
