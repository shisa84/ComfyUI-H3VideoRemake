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

Edits the clip's prompt. Connect **Media Input**'s `data` to `data`.

- One text with the six H3 section headers: `subject_definitions:`, `summary:`, `retention_analysis:`, `detailed_description:`, `overall_soundscape:`, `non_diegetic_music:`.
- As soon as the connected Media Input has run, the sections left empty in the editor are filled with its `data`, so the text can be seen and edited (the Prompt node itself does not need to run). **Fill from data** replaces the sections with Media Input's latest `data` (e.g. after changing subjects). At run time, a section still empty in the editor is taken from `data`.
- The chips above the text insert `<Picture N>`, `<Subject N>` and `<Audio N>` from the connected Media Input at the cursor; tags, `[Shot N]` and section headers are highlighted.
- **A / B**: two versions of the text; the selected one is output. B starts as a copy of A.

| Output | |
|---|---|
| `prompt` | All six sections in H3 order, empty ones included: the editor's text, or `data`'s where the editor's section is empty. |
