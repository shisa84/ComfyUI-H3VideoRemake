// Media picker for "H3 Remake · Media Input", modelled on Easy-Media's Multi Images Loader:
// thumbnail grid with an add card (uploads from the computer), hover preview/delete, drag to reorder,
// drop files to upload. Adds an audio list (play, on/off) and subjects: 1+ images with an optional reference audio.
// The widget value is the JSON state read by media.py.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "H3RemakeMediaInput";
const WIDGET_TYPE = "H3REMAKE_MEDIA_DATA";
const MAX_IMAGES = 9;
const MAX_AUDIOS = 3;
// Must match SUBJECT_KINDS in media.py. "auto" leaves the type to be worked out later.
const SUBJECT_KINDS = ["auto", "person", "animal", "object", "outfit", "vehicle", "location"];
const SUBJECT_COLORS = ["#e0823d", "#3db8e0", "#b36ae0", "#5fc868", "#e05a8a", "#d0bc3d", "#6a8ae0", "#e0705a", "#4fc9b0"];

const ICONS = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" class="fill"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 4h3v16H7zM14 4h3v16h-3z" class="fill"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
};

const CSS = `
.h3r{position:relative;display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;box-sizing:border-box;padding:6px;
  font:12px/1.3 sans-serif;color:var(--fg-color,#ddd);background:rgba(0,0,0,.25);border-radius:6px;overflow:hidden}
.h3r *{box-sizing:border-box}
.h3r svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.h3r svg .fill{fill:currentColor;stroke:none}
.h3r-head{display:flex;align-items:center;justify-content:space-between;color:#aaa;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.h3r-link{background:none;border:0;color:#e66;cursor:pointer;font-size:11px;padding:2px 4px}
.h3r-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;overflow-y:auto;min-height:0;flex:1 1 auto;align-content:start;
  border:1px solid transparent;border-radius:6px;padding:2px}
.h3r-grid.drag{border-color:#4a9eff;background:rgba(74,158,255,.08)}
.h3r-card{position:relative;aspect-ratio:1;border:1px solid #444;border-radius:6px;background:#000;overflow:hidden;cursor:pointer}
.h3r-card img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}
.h3r-num{position:absolute;left:0;bottom:0;background:rgba(0,0,0,.6);padding:1px 6px;font-size:11px;border-top-right-radius:4px}
.h3r-badge{position:absolute;left:3px;top:3px;display:flex;gap:2px}
.h3r-badge span{color:#111;font-weight:600;border-radius:4px;padding:1px 4px;font-size:10px}
.h3r-tools{position:absolute;right:3px;top:3px;display:flex;gap:3px;opacity:0;transition:opacity .1s}
.h3r-card:hover .h3r-tools{opacity:1}
.h3r-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:5px;border:0;cursor:pointer;
  background:rgba(40,40,40,.9);color:#eee}
.h3r-btn:hover{background:#555}
.h3r-btn.danger{background:rgba(190,40,40,.9)}
.h3r-add{aspect-ratio:1;border:1px dashed #666;border-radius:6px;background:none;color:#999;cursor:pointer;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:4px;font-size:11px}
.h3r-add:hover{border-color:#aaa;color:#ddd}
.h3r-add svg{width:20px;height:20px}
.h3r-audios{display:flex;flex-direction:column;gap:4px;flex:0 0 auto}
.h3r-audio{display:flex;align-items:center;gap:6px;border:1px solid #444;border-radius:6px;padding:4px 6px;background:rgba(30,60,110,.35)}
.h3r-audio.off{opacity:.55;background:rgba(60,60,60,.3)}
.h3r-audio .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.h3r-audio .dur{color:#aaa;font-variant-numeric:tabular-nums}
.h3r-switch{position:relative;width:30px;height:16px;border-radius:8px;border:0;background:#555;cursor:pointer;flex:0 0 auto}
.h3r-switch::after{content:"";position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#ddd;transition:left .12s}
.h3r-switch.on{background:#2f6fd6}.h3r-switch.on::after{left:16px}
.h3r-addaudio,.h3r-addsubject{border:1px dashed #666;border-radius:6px;background:none;color:#999;cursor:pointer;padding:5px;display:flex;align-items:center;
  justify-content:center;gap:4px;font-size:11px}
.h3r-addaudio:hover,.h3r-addsubject:hover{border-color:#aaa;color:#ddd}
.h3r-subjects{display:flex;flex-direction:column;gap:4px;flex:0 0 auto;max-height:260px;overflow-y:auto}
.h3r-subject{display:flex;flex-direction:column;gap:5px;border:1px solid #444;border-left:4px solid var(--c);border-radius:6px;padding:5px 6px;background:rgba(255,255,255,.03)}
.h3r-subject .row{display:flex;align-items:center;gap:6px}
.h3r-subject .tag{color:var(--c);font-weight:600;flex:0 0 auto}
.h3r-subject .grow{flex:1}
.h3r-subject select{background:#222;color:#ddd;border:1px solid #555;border-radius:4px;font-size:11px;padding:1px 2px;max-width:140px}
.h3r-subject .hint{color:#888;font-size:11px}
.h3r-thumb{position:relative;width:34px;height:34px;padding:0;border:2px solid #444;border-radius:5px;background:#000;cursor:pointer;opacity:.45;overflow:hidden}
.h3r-thumb.on{border-color:var(--c);opacity:1}
.h3r-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.h3r-thumb span{position:absolute;left:0;bottom:0;background:rgba(0,0,0,.7);color:#fff;font-size:9px;padding:0 3px}
.h3r-preview{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:8px;background:#000}
.h3r-preview img{max-width:100%;max-height:100%;object-fit:contain}
.h3r-preview .h3r-back{position:absolute;left:8px;top:8px;display:flex;gap:4px;align-items:center;background:#333;color:#eee;border:0;
  border-radius:5px;padding:4px 8px;cursor:pointer}
`;

function injectStyle() {
  if (document.getElementById("h3remake-media-css")) return;
  const style = document.createElement("style");
  style.id = "h3remake-media-css";
  style.textContent = CSS;
  document.head.appendChild(style);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const subjectColor = (index) => SUBJECT_COLORS[index % SUBJECT_COLORS.length];
const uid = () => Math.random().toString(36).slice(2, 10);
export const baseName = (path) => path.split("/").pop();

export function viewUrl(item) {
  const slash = item.path.lastIndexOf("/");
  const filename = slash >= 0 ? item.path.slice(slash + 1) : item.path;
  const subfolder = slash >= 0 ? item.path.slice(0, slash) : "";
  return api.apiURL(`/view?filename=${encodeURIComponent(filename)}&type=input&subfolder=${encodeURIComponent(subfolder)}`);
}

async function uploadFile(file) {
  const form = new FormData();
  form.append("image", file);
  form.append("type", "input");
  form.append("overwrite", "false");
  const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
  if (response.status !== 200) throw new Error(`upload failed (${response.status})`);
  const result = await response.json();
  return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
}

const durations = new Map(); // view url -> seconds
function formatSeconds(s) {
  if (!Number.isFinite(s)) return "--:--";
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

// Keep wheel/keys inside the widget instead of zooming the canvas or triggering shortcuts.
function isolate(node) {
  node.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  node.addEventListener("keydown", (e) => e.stopPropagation());
  return node;
}

class MediaPicker {
  constructor(node) {
    this.node = node;
    this.state = { images: [], audios: [], subjects: [] };
    this.previewUrl = null;
    this.player = new Audio();
    this.playingId = null;
    this.player.addEventListener("ended", () => { this.playingId = null; this.render(); });
    this.root = isolate(el("div", { class: "h3r" }));
    this.render();
  }

  get value() { return JSON.stringify(this.state); }

  load(value) {
    try {
      const data = typeof value === "string" ? JSON.parse(value || "{}") : value || {};
      this.state = {
        images: Array.isArray(data.images) ? data.images.slice(0, MAX_IMAGES) : [],
        audios: Array.isArray(data.audios) ? data.audios.slice(0, MAX_AUDIOS) : [],
        subjects: Array.isArray(data.subjects) ? data.subjects : [],
      };
    } catch {
      this.state = { images: [], audios: [], subjects: [] };
    }
    this.render();
  }

  commit() {
    this.node.setDirtyCanvas?.(true, true);
    this.render();
    // Prompt nodes fed by this one refresh their reference chips.
    window.dispatchEvent(new CustomEvent("h3remake:media-changed", { detail: this.node }));
  }

  // ---------- rendering ----------
  render() {
    this.root.replaceChildren(this.renderImages(), this.renderAudios(), this.renderSubjects());
    if (this.previewUrl) this.root.append(this.renderPreview());
  }

  renderImages() {
    const { images, subjects } = this.state;
    const grid = el("div", { class: "h3r-grid" });
    grid.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); grid.classList.add("drag"); }
    });
    grid.addEventListener("dragleave", (e) => { if (!grid.contains(e.relatedTarget)) grid.classList.remove("drag"); });
    grid.addEventListener("drop", (e) => {
      grid.classList.remove("drag");
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      this.uploadInto("image", [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")), null);
    });

    images.forEach((image, index) => {
      const members = subjects.map((subject, i) => ({ subject, i })).filter(({ subject }) => subject.image_ids.includes(image.id));
      const card = el("div", { class: "h3r-card", draggable: "true", title: image.path,
        onclick: () => this.pickFiles("image", image.id) }, [
        el("img", { src: viewUrl(image), loading: "lazy", alt: image.path }),
        el("span", { class: "h3r-num" }, index + 1),
        members.length ? el("div", { class: "h3r-badge" }, members.map(({ subject, i }) =>
          el("span", { style: `background:${subjectColor(i)}`, title: `Subject ${i + 1} (${subject.kind})` }, `S${i + 1}`))) : null,
        el("div", { class: "h3r-tools" }, [
          el("button", { class: "h3r-btn", title: "Preview", html: ICONS.eye,
            onclick: (e) => { e.stopPropagation(); this.previewUrl = viewUrl(image); this.render(); } }),
          el("button", { class: "h3r-btn danger", title: "Remove", html: ICONS.trash,
            onclick: (e) => { e.stopPropagation(); this.removeImage(image.id); } }),
        ]),
      ]);
      card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/h3r-image", image.id); });
      card.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/h3r-image")) e.preventDefault(); });
      card.addEventListener("drop", (e) => {
        const sourceId = e.dataTransfer.getData("text/h3r-image");
        if (!sourceId) return;
        e.preventDefault();
        e.stopPropagation();
        this.moveImage(sourceId, image.id);
      });
      grid.append(card);
    });

    if (images.length < MAX_IMAGES) {
      grid.append(el("button", { class: "h3r-add", onclick: () => this.pickFiles("image", null),
        html: `${ICONS.plus}<span>Add image</span>` }));
    }

    return el("div", { style: "display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-height:0" }, [
      el("div", { class: "h3r-head" }, [
        el("span", {}, `Images ${images.length}/${MAX_IMAGES}`),
        images.length ? el("button", { class: "h3r-link", onclick: () => this.clearImages() }, "Clear all") : null,
      ]),
      grid,
    ]);
  }

  renderAudios() {
    const { audios } = this.state;
    const rows = audios.map((audio, index) => {
      const url = viewUrl(audio);
      const enabled = audio.enabled !== false;
      const duration = el("span", { class: "dur" }, formatSeconds(durations.get(url)));
      if (!durations.has(url)) {
        const probe = new Audio();
        probe.preload = "metadata";
        probe.addEventListener("loadedmetadata", () => { durations.set(url, probe.duration); duration.textContent = formatSeconds(probe.duration); });
        probe.src = url;
      }
      const playing = this.playingId === audio.id;
      return el("div", { class: `h3r-audio${enabled ? "" : " off"}` }, [
        el("button", { class: "h3r-btn", title: playing ? "Pause" : "Play", html: playing ? ICONS.pause : ICONS.play,
          onclick: () => this.togglePlay(audio) }),
        el("span", {}, `${index + 1}`),
        el("span", { class: "name", title: audio.path }, baseName(audio.path)),
        duration,
        el("button", { class: `h3r-switch${enabled ? " on" : ""}`, title: enabled ? "Audio on" : "Audio off",
          onclick: () => { audio.enabled = !enabled; this.commit(); } }),
        el("button", { class: "h3r-btn", title: "Replace", html: ICONS.upload, onclick: () => this.pickFiles("audio", audio.id) }),
        el("button", { class: "h3r-btn danger", title: "Remove", html: ICONS.trash, onclick: () => this.removeAudio(audio.id) }),
      ]);
    });

    if (audios.length < MAX_AUDIOS) {
      rows.push(el("button", { class: "h3r-addaudio", onclick: () => this.pickFiles("audio", null),
        html: `${ICONS.plus}<span>Add audio</span>` }));
    }
    return el("div", { class: "h3r-audios" }, [
      el("div", { class: "h3r-head" }, [el("span", {}, `Audio ${audios.length}/${MAX_AUDIOS}`)]),
      ...rows,
    ]);
  }

  renderSubjects() {
    const { images, audios, subjects } = this.state;
    const cards = subjects.map((subject, index) => {
      const audio = el("select", { title: "Reference audio", onchange: (e) => { subject.audio_id = e.target.value || null; this.commit(); } }, [
        el("option", { value: "" }, "no audio"),
        ...audios.map((a, i) => el("option", { value: a.id, selected: subject.audio_id === a.id }, `audio ${i + 1} · ${baseName(a.path)}`)),
      ]);
      const thumbs = images.length ? images.map((image, i) => el("button", {
        class: `h3r-thumb${subject.image_ids.includes(image.id) ? " on" : ""}`, title: `image ${i + 1}`,
        onclick: () => this.toggleSubjectImage(subject, image.id) }, [el("img", { src: viewUrl(image) }), el("span", {}, i + 1)]))
        : [el("span", { class: "hint" }, "Add images first")];
      const kind = el("select", { title: "Subject type", onchange: (e) => { subject.kind = e.target.value; this.commit(); } },
        SUBJECT_KINDS.map((value) => el("option", { value, selected: subject.kind === value }, value)));
      return el("div", { class: "h3r-subject", style: `--c:${subjectColor(index)}` }, [
        el("div", { class: "row" }, [
          el("span", { class: "tag" }, `S${index + 1}`),
          kind,
          audio,
          el("span", { class: "grow" }),
          el("button", { class: "h3r-btn danger", title: "Remove subject", html: ICONS.trash, onclick: () => this.removeSubject(subject.id) }),
        ]),
        el("div", { class: "row", style: "flex-wrap:wrap;gap:4px" }, thumbs),
      ]);
    });
    if (subjects.length < MAX_IMAGES) {
      cards.push(el("button", { class: "h3r-addsubject", onclick: () => this.addSubject(), html: `${ICONS.plus}<span>Add subject</span>` }));
    }
    return el("div", { class: "h3r-subjects" }, [
      el("div", { class: "h3r-head" }, [el("span", {}, `Subjects ${subjects.length}`)]),
      ...cards,
    ]);
  }

  renderPreview() {
    return el("div", { class: "h3r-preview", onclick: () => { this.previewUrl = null; this.render(); } }, [
      el("img", { src: this.previewUrl }),
      el("button", { class: "h3r-back", html: `${ICONS.back}<span>Back</span>` }),
    ]);
  }

  // ---------- actions ----------
  pickFiles(kind, replaceId) {
    const input = el("input", { type: "file", accept: kind === "image" ? "image/*" : "audio/*", multiple: !replaceId });
    input.addEventListener("change", () => this.uploadInto(kind, [...input.files], replaceId));
    input.click();
  }

  addPaths(kind, paths) {
    if (kind === "image") {
      const room = MAX_IMAGES - this.state.images.length;
      this.state.images.push(...paths.slice(0, room).map((path) => ({ id: uid(), path })));
    } else {
      const room = MAX_AUDIOS - this.state.audios.length;
      this.state.audios.push(...paths.slice(0, room).map((path) => ({ id: uid(), path, enabled: true })));
    }
    this.commit();
  }

  replacePath(kind, id, path) {
    const target = this.state[kind === "image" ? "images" : "audios"].find((m) => m.id === id);
    if (target) target.path = path;
    this.commit();
  }

  async uploadInto(kind, files, replaceId) {
    if (!files.length) return;
    const room = replaceId ? 1 : (kind === "image" ? MAX_IMAGES - this.state.images.length : MAX_AUDIOS - this.state.audios.length);
    const results = await Promise.allSettled(files.slice(0, room).map(uploadFile));
    const uploaded = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    results.filter((r) => r.status === "rejected").forEach((r) => console.error("[H3VideoRemake] upload failed:", r.reason));
    if (!uploaded.length) return;
    if (replaceId) this.replacePath(kind, replaceId, uploaded[0]);
    else this.addPaths(kind, uploaded);
  }

  removeImage(id) {
    this.state.images = this.state.images.filter((image) => image.id !== id);
    for (const subject of this.state.subjects) subject.image_ids = subject.image_ids.filter((imageId) => imageId !== id);
    this.commit();
  }

  clearImages() {
    this.state.images = [];
    for (const subject of this.state.subjects) subject.image_ids = [];
    this.commit();
  }

  moveImage(sourceId, targetId) {
    const images = this.state.images;
    const from = images.findIndex((image) => image.id === sourceId);
    const to = images.findIndex((image) => image.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    images.splice(to, 0, images.splice(from, 1)[0]);
    this.commit();
  }

  removeAudio(id) {
    if (this.playingId === id) { this.player.pause(); this.playingId = null; }
    this.state.audios = this.state.audios.filter((audio) => audio.id !== id);
    for (const subject of this.state.subjects) if (subject.audio_id === id) subject.audio_id = null;
    this.commit();
  }

  addSubject() {
    this.state.subjects.push({ id: uid(), kind: "auto", image_ids: [], audio_id: null });
    this.commit();
  }

  removeSubject(id) {
    this.state.subjects = this.state.subjects.filter((subject) => subject.id !== id);
    this.commit();
  }

  toggleSubjectImage(subject, imageId) {
    subject.image_ids = subject.image_ids.includes(imageId)
      ? subject.image_ids.filter((id) => id !== imageId)
      : [...subject.image_ids, imageId];
    this.commit();
  }

  togglePlay(audio) {
    if (this.playingId === audio.id) {
      this.player.pause();
      this.playingId = null;
    } else {
      this.player.src = viewUrl(audio);
      this.player.play().catch((error) => console.error("[H3VideoRemake] audio playback failed:", error));
      this.playingId = audio.id;
    }
    this.render();
  }
}

app.registerExtension({
  name: "H3VideoRemake.MediaInput",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);
      this.setSize([480, 800]);
    };
    const onRemoved = nodeType.prototype.onRemoved;
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      if (!output?.h3remake_data?.[0]) return;
      // Latest data sections, picked up by the Prompt nodes fed by this one.
      this.h3remakeData = JSON.parse(output.h3remake_data[0]);
      window.dispatchEvent(new CustomEvent("h3remake:data", { detail: this }));
    };
    nodeType.prototype.onRemoved = function () {
      this.h3remakePicker?.player.pause();
      onRemoved?.apply(this, arguments);
    };
  },

  getCustomWidgets() {
    return {
      [WIDGET_TYPE](node, inputName) {
        injectStyle();
        const picker = new MediaPicker(node);
        node.h3remakePicker = picker;
        const widget = node.addDOMWidget(inputName, WIDGET_TYPE, picker.root, {
          getValue: () => picker.value,
          setValue: (value) => picker.load(value),
          getMinHeight: () => 480,
          hideOnZoom: false,
          serialize: true,
        });
        widget.serializeValue = () => picker.value;
        return { widget };
      },
    };
  },
});
