# H3 Video Remake

Multi-clip MiniMax H3 videos in ComfyUI.

## Nodes

### H3 Remake · Media Input

Upload reference media directly in the node: up to 9 images and 3 audios, then group them into subjects.

**Images**
- **Add image** opens your computer's file dialog (several files at once). Image files can also be dropped onto the grid.
- Click a thumbnail to replace it, drag it to reorder. Hover for **preview** (eye) and **remove** (bin).
- Colored `S1`, `S2`… badges show which subjects use an image.

**Audio**
- **Add audio** opens the file dialog for audio files.
- Each audio row: play/pause, duration, on/off switch, replace, remove.
- Off: the audio stays in the list but is ignored downstream.

**Subjects**
- **Add subject** creates a subject: a type, one or more images (click the thumbnails to select them) and an optional reference audio.
- Types: `auto` (default, left to be worked out later), `person`, `animal`, `object`, `outfit`, `vehicle`, `location`.
- A subject needs at least one image.

**use_llm**
- `off` (default): `data` is built from the subject types alone.
- `on`: connect a vision LLM text encoder (e.g. the H3 CLIP) to `clip`. Each subject image is described (2-3 sentences for a person, one for the other types), with a prompt that depends on the subject type (based on H3LookSheets' Describe Reference; a person is described with the outfit they wear in the photo), and the description is added to that subject's line in `subject_definitions`. An empty reply, a refusal or a rambling answer is retried with a new seed, then once with a simpler prompt; an image that still fails is left without description. `max_length`: token budget per description; `seed`: sampling seed.

| Output | |
|---|---|
| `images` | The images in grid order, as a list: image N is `<Picture N>`. |
| `audios` | The switched-on audios in order, as a list: the first one is `<Audio 1>`. Switched-off audios are skipped. |
| `data` | JSON with the six H3 prompt sections; `subject_definitions` (one line per subject and per switched-on audio) and `retention_analysis` (`<Subject N> (appears in [Shot 1]): fully_preserved`, `<Audio N>: reference - …`). |
| `debug` | `use_llm` on: for each described image, the prompt sent, every raw reply (retries and fallback included) and the description kept. |

### H3 Remake · Image Aggregator

Takes one image list (e.g. **Media Input**'s `images`) and puts its images, in order, on `ref_image_0` … `ref_image_8`. Wire them into `MiniMaxH3ReferenceToVideo`; unused slots come out empty and are skipped like a disconnected socket. Past 9 images, the rest are dropped with a warning.

### H3 Remake · Audio Aggregator

Same for audio: one audio list (e.g. **Media Input**'s `audios`) onto `ref_audio_0` … `ref_audio_2`. Past 3 audios, the rest are dropped with a warning.

### H3 Remake · Prompt

Manages the clips and edits their prompts. Connect **Media Input**'s `data` to `data`.

**General params** (top): `1 phase` / `2 phase` sets whether there's an upscale stage. Resolution is computed the same way as the core **Resolution Selector** node, from an aspect ratio preset and a megapixel target (`width`/`height` shown next to it): the base one always, plus an upscale one (its own megapixel target, same aspect ratio) once `2 phase` is on. `project folder` is where clip latents are saved/loaded (a subfolder under ComfyUI's `output`, read by **H3 Remake · Save/Load Clip Latent** below).

`Draft` (checkbox) + its own megapixel target (default `0.1`): when on, `width`/`height` themselves output that lower resolution instead of the base one, so every node already wired to them (`MiniMaxH3ReferenceToVideo`, the empty latent, a continuity resize...) runs the clip at draft resolution together - nothing to rewire per node, and nothing to keep in sync. **▶ Draft** queues the selected clip once (same single-queue mechanism as Chain, for one clip).

`Manual` / `Auto` sets how continuity picks a take for a normal, one-clip-at-a-time run: **Manual** *blocks generation outright* if the previous clip has no take selected yet (fails with a clear error instead of quietly generating without continuity) — a deliberate stop-and-check gate; **Auto** always uses the previous clip's latest take, no selection needed.

**▶ Chain** generates every clip without a selected take, in order, unsupervised: it starts at the first one, runs it, selects the take it just made on success, moves to the next, and repeats to the end. Since nothing is manually reviewed while it runs, it picks the result itself as it goes — regardless of the Manual/Auto setting, which only affects individually-triggered runs outside the chain. Stops at the first failed clip; click **■ Stop** to stop after the clip currently running instead of continuing. Disabled once every clip already has a take selected.

**Clips**: one block per clip with its duration (`Clip 1 · 5.0s`…), `✓` once a take is selected; **+ Add clip** adds one. Choose a clip to open its editor below; the header of the chosen clip sets its duration in seconds, moves it left/right, duplicates (starts with no takes) or deletes it. Each clip has its own prompt.

From clip 2 onward, the header also has a **continue from** picker: which earlier clip's selected take to continue from, defaulting to the immediately previous one (`Clip N (auto)`). Pick any earlier clip to skip the ones in between - e.g. clip 3 continuing from clip 1 instead of clip 2.

**Editor** (chosen clip):
- One text with the six H3 section headers: `subject_definitions:`, `summary:`, `retention_analysis:`, `detailed_description:`, `overall_soundscape:`, `non_diegetic_music:`.
- As soon as the connected Media Input has run, the sections left empty are filled with its `data` (in every clip), so the text can be seen and edited. **Fill from data** replaces the sections of the version shown with Media Input's latest `data` (e.g. after changing subjects). At run time, a section still empty is taken from `data`.
- The chips above the text insert `<Picture N>`, `<Subject N>` and `<Audio N>` from the connected Media Input at the cursor; tags, `[Shot N]` and section headers are highlighted.
- **A / B**: two versions of the clip's text; the selected one is output. B starts as a copy of A.

**Takes** (bottom): every run of the selected clip is a new, numbered take — queue the same clip 10 times (e.g. set the native Run count to 10) and 10 takes show up here, nothing is overwritten. A take with a recorded video shows a thumbnail (its last/most complete file - the audio-muxed one, if there is one); click it to open that file full-size in a modal, with the take number and every file recorded for it (latent, and all of `video_filenames`) shown, plus a **Delete this take** button that removes that one take's latent and video files and closes the modal (Escape, the ✕, or clicking outside it also closes it without deleting). Click the take itself (not the thumbnail) to select it (click again to deselect); the selected take is what the next clip's continuity uses, and what shows the `✓` in the clips row above. **Delete others** (enabled once one is selected) removes every other take's latent *and every one of its recorded video files* for this clip.

The take list is kept live by a browser event each time a take is saved - if it was generated while the tab wasn't open (closed, reloading, server restart mid-run), the take is saved to disk but missing here. **⟳ Resync from disk** rebuilds the list from the `.latent` files actually on disk for this clip, matching each one to its video files by save order and timing (the take whose `.latent` was written right after a given video's files gets matched to it); a take whose video can't be matched confidently shows up with no thumbnail rather than a guessed one. Known takes are left untouched.

| Output | |
|---|---|
| `prompt` | The chosen clip's six sections in H3 order, empty ones included: its text, or `data`'s where a section is empty. |
| `length` | The chosen clip's duration in frames at 24 fps, for `MiniMaxH3ReferenceToVideo`'s `length`. |
| `width` / `height` | The general params' base resolution, or the draft resolution when `Draft` is checked. |
| `two_phase` | Whether the general params ask for an upscale phase. |
| `upscale_width` / `upscale_height` | The general params' upscale resolution (meaningful only when `two_phase` is on). |
| `project_folder` / `clip_index` / `continuity_clip_index` / `previous_take` | For **H3 Remake · Save/Load Clip Latent**, below. |

### H3 Remake · Save Clip Latent / H3 Remake · Load Clip Latent

Two separate nodes, not one — **Load** goes before the sampler (its `continuity_latent` feeds the clip's init/continuity latent), **Save** goes after it (its `latent` input comes from the sampler's output). Save takes `project_folder` and `clip_index` from Prompt; Load takes `project_folder`, `continuity_clip_index` and `previous_take`.

They have to be two nodes. A single node that both received the sampler's output (to save it) and fed the sampler its continuity latent (to use it) would depend on its own result through the sampler in between — ComfyUI refuses that as a dependency cycle (*"Dependency cycle detected"*), and that's exactly what happened the first time this was tried as one node. Splitting Save and Load like this is the same fix ComfyUI-H3-Motion-Context uses, for the same reason.

**Save** writes the clip's latent to `project_folder/clip_N_take_K.latent` every time it runs (K auto-numbered — each run is a new take, nothing is overwritten) and, if `video_filenames` is connected, records every file that run's video-save node wrote for Prompt's take list below. Wire `video_filenames` directly from `VHS_VideoCombine`'s `Filenames` output — not through `VHS_SelectFilename`, which would only keep one of the files it wrote (`VHS_VideoCombine` can produce several per run: a first-frame `.png`, a silent video, and an audio-muxed version). Save converts each of those (always absolute filesystem paths) to one relative to ComfyUI's `output` folder before recording it (what the thumbnail/player/deletion actually need). Save has no graph output, so nothing can be wired back into it.

**Load** reads clip `continuity_clip_index`'s take number `previous_take` (0 means nothing to load — the first clip, or manual mode with no take selected yet) and outputs its saved latent, or empty if there's nothing to load. `continuity_clip_index` is the editor's **continue from** picker above: the immediately previous clip by default, or any earlier one. It only reads Prompt's outputs and a file — never the sampler's output — so it can safely feed the sampler without looping back.

| Output | |
|---|---|
| Save: none | Runs for its side effect (`is_output_node`). |
| Load: `continuity_latent` | The take `previous_take` of clip `continuity_clip_index`'s saved latent, or empty if `previous_take` is 0. |

### Skipping a previous-clip-only branch (e.g. H3 Motion Context)

Some nodes only make sense from clip 2 onward — e.g. `H3 Motion Context Load Latent` + `H3 Motion Context Resize`, which need a previous clip's saved latent. On clip 1 there's nothing to load, but **don't disable `H3 Motion Context` itself**: its own docs say to leave it enabled with `context_latent` empty, and it passes the conditioning through untouched.

Use ComfyUI core's **If/Else Switch** node (`utilities/logic`, `switch`/`on_true`/`on_false` — may need "show experimental nodes" in settings to find it in the add-node search) — not a custom H3VideoRemake node, and not `ExecutionBlocker`-based bypassing.

**Not `easy ifElse`** (ComfyUI-Easy-Use, "If else"): despite the same lazy mechanism, its `on_true`/`on_false` aren't marked `optional` in its schema, so ComfyUI's validator refuses to queue unless *both* are connected — defeating the point of leaving `on_false` empty. Core's If/Else Switch declares both `optional=True` and actually allows it.

`switch` needs a boolean, and Prompt's `previous_take` is an int (0 = nothing to load) — add a **Compare** node (`a > 0`, `a` = `previous_take`) in between to get one. Both groups can share that same boolean (one Compare node is enough), but each needs its own `on_true` — a different Resize output per group:
- `switch`: `previous_take > 0` (via Compare).
- `on_true` (lazy): that group's `H3 Motion Context Resize` output. Only evaluated when `switch` is true, so `Load Latent`/`Resize` never run on clip 1 — no risk of `Resize` erroring on an empty latent.
- `on_false`: leave unconnected (outputs a plain empty value).
- Output → that group's `H3 Motion Context`'s `context_latent`.

Why not a blocking/gate node: `ExecutionBlocker` (the mechanism a "gate" would need) blocks *every* node that reads the blocked output, even one whose input is optional and handles emptiness fine — there's no way to stop just the `Load Latent`/`Resize` branch while letting `H3 Motion Context` keep running. That was tried here first and silently stopped the whole clip 1 render (no output, no error) instead of skipping only the intended branch. The Switch node's lazy inputs are the correct primitive: the unused branch is never evaluated at all, and the consumer gets an ordinary value, not a block marker.
