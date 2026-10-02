from __future__ import annotations

import json
import logging
import math

from comfy_api.latest import io
from comfy_extras.nodes_resolution import ASPECT_RATIOS

from .clip_latent import load_clip_latent, next_take_number, relative_to_output, save_clip_latent
from .describe import describe_image
from .media import MAX_AUDIOS, MAX_IMAGES, build_media
from .prompt import build_prompt_data
from .prompt_sections import DEFAULT_USER_PROMPT, assemble_prompt, data_sections

# Rendered by web/h3remake_media.js; the value is the JSON state of the picker.
MediaData = io.Custom("H3REMAKE_MEDIA_DATA")
# Rendered by web/h3remake_prompt.js; the value is JSON: {"clips": [{"id", "duration", "variant", "user_a",
# "user_b", "generations": [{"id", "take", "videoPath", "videoPaths"}], "activeGeneration"}], "selected",
# "general": {"aspect_ratio", "megapixels", "two_phase", "upscale_megapixels", "project_folder", "validation"}}.
PromptData = io.Custom("H3REMAKE_PROMPT_DATA")
# ComfyUI-VideoHelperSuite's VHS_VideoCombine output: (save_to_output: bool, file_paths: list[str]). Reading
# it directly (instead of going through VHS_SelectFilename) gets every file one combine call wrote - the
# silent video, the audio-muxed version, and the first-frame png - not just whichever one an index picks.
VhsFilenames = io.Custom("VHS_FILENAMES")

RESOLUTION_MULTIPLE = 32  # MiniMax H3's per-axis rounding (comfy_extras/nodes_minimax_h3.py)


def _resolution(aspect_ratio: str, megapixels: float) -> tuple[int, int]:
    """Same formula as the core Resolution Selector node (comfy_extras/nodes_resolution.py)."""
    w_ratio, h_ratio = ASPECT_RATIOS.get(aspect_ratio, (16, 9))
    scale = math.sqrt(megapixels * 1024 * 1024 / (w_ratio * h_ratio))
    width = round(w_ratio * scale / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE
    height = round(h_ratio * scale / RESOLUTION_MULTIPLE) * RESOLUTION_MULTIPLE
    return width, height


class H3RemakeMediaInput(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="H3RemakeMediaInput",
            display_name="H3 Remake · Media Input",
            category="H3VideoRemake",
            description=f"Upload up to {MAX_IMAGES} reference images and {MAX_AUDIOS} reference audios and group them into subjects.",
            inputs=[
                MediaData.Input("media_data"),
                io.DynamicCombo.Input("use_llm", tooltip="on: describe each subject image with the vision LLM wired to clip "
                                                         "and add the descriptions to subject_definitions. off: data is built from "
                                                         "the subject types alone.", options=[
                    io.DynamicCombo.Option("off", []),
                    io.DynamicCombo.Option("on", [
                        io.Int.Input("max_length", default=256, min=16, max=4096, tooltip="Token budget per description."),
                        io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff,
                                     tooltip="Sampling seed; retries after an unusable answer step away from it."),
                    ]),
                ]),
                io.Clip.Input("clip", optional=True, tooltip="Vision LLM text encoder (e.g. the H3 CLIP), only read when use_llm is on."),
            ],
            outputs=[
                io.Image.Output(id="images", display_name="images", is_output_list=True,
                                tooltip="The images in grid order: image N is <Picture N>."),
                io.Audio.Output(id="audios", display_name="audios", is_output_list=True,
                                tooltip="The switched-on audios in order: the first one is <Audio 1>."),
                io.String.Output(id="data", display_name="data",
                                 tooltip="JSON with the subject_definitions and retention_analysis prompt sections."),
                io.String.Output(id="debug", display_name="debug",
                                 tooltip="use_llm on: for each described image, the prompt sent to the LLM, every raw reply "
                                         "(retries and fallback included) and the description kept."),
            ],
        )

    @classmethod
    def execute(cls, media_data, use_llm, clip=None) -> io.NodeOutput:
        media = build_media(media_data)
        descriptions, debug = None, "use_llm is off"
        if use_llm["use_llm"] == "on":
            if clip is None:
                raise ValueError("use_llm is on: connect a vision LLM text encoder (e.g. the H3 CLIP) to clip")
            descriptions, blocks = {}, []
            for s in media.subjects:
                for n in s.images:
                    text, log = describe_image(clip, s.kind, media.images[n - 1], use_llm["max_length"], use_llm["seed"])
                    descriptions[(s.number, n)] = text
                    blocks.append(f"=== <Subject {s.number}> ({s.kind}) - <Picture {n}> ===\n{log}")
            debug = "\n\n".join(blocks) or "no subject to describe"
        data = json.dumps(build_prompt_data(media, descriptions), ensure_ascii=False, indent=2)
        # data also goes to the UI so a connected Prompt node can fill its editor without running itself.
        return io.NodeOutput(list(media.images), [a.audio for a in media.active_audios()], data, debug,
                             ui={"h3remake_data": [data]})


def _to_slots(node_id: str, items: list, limit: int) -> list:
    """The list's items in order on `limit` slots, None for the unused ones."""
    items = [item for item in items if item is not None]
    if len(items) > limit:
        logging.warning("[%s] %d received, only the first %d are kept (MiniMaxH3ReferenceToVideo's cap).", node_id, len(items), limit)
    return items[:limit] + [None] * (limit - len(items))


class H3RemakeImageAggregator(io.ComfyNode):
    """Spread an image list onto MiniMaxH3ReferenceToVideo's ref_image_0...8 slots."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="H3RemakeImageAggregator",
            display_name="H3 Remake · Image Aggregator",
            category="H3VideoRemake",
            description=f"Puts the images of the list, in order, on ref_image_0...{MAX_IMAGES - 1}. Wire them into "
                        "MiniMaxH3ReferenceToVideo; unused slots come out empty and are skipped like a disconnected socket.",
            is_input_list=True,
            inputs=[io.Image.Input("images", tooltip="Image list, e.g. Media Input's images.")],
            outputs=[io.Image.Output(id=f"ref_image_{i}", display_name=f"ref_image_{i}", tooltip=f"<Picture {i + 1}> in the prompt.")
                     for i in range(MAX_IMAGES)],
        )

    @classmethod
    def execute(cls, images) -> io.NodeOutput:
        return io.NodeOutput(*_to_slots("H3RemakeImageAggregator", images, MAX_IMAGES))


class H3RemakeAudioAggregator(io.ComfyNode):
    """Spread an audio list onto MiniMaxH3ReferenceToVideo's ref_audio_0...2 slots."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="H3RemakeAudioAggregator",
            display_name="H3 Remake · Audio Aggregator",
            category="H3VideoRemake",
            description=f"Puts the audios of the list, in order, on ref_audio_0...{MAX_AUDIOS - 1}. Wire them into "
                        "MiniMaxH3ReferenceToVideo; unused slots come out empty and are skipped like a disconnected socket.",
            is_input_list=True,
            inputs=[io.Audio.Input("audios", tooltip="Audio list, e.g. Media Input's audios.")],
            outputs=[io.Audio.Output(id=f"ref_audio_{i}", display_name=f"ref_audio_{i}", tooltip=f"<Audio {i + 1}> in the prompt.")
                     for i in range(MAX_AUDIOS)],
        )

    @classmethod
    def execute(cls, audios) -> io.NodeOutput:
        return io.NodeOutput(*_to_slots("H3RemakeAudioAggregator", audios, MAX_AUDIOS))


FPS = 24  # MiniMax H3 frame rate


class H3RemakePrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="H3RemakePrompt",
            display_name="H3 Remake · Prompt",
            category="H3VideoRemake",
            # Output node so it can be run on its own (selection Run button) to fill the editor from data.
            is_output_node=True,
            description="Manage the clips (duration and prompt each) and edit the chosen clip's six H3 prompt sections "
                        "(A/B versions). Sections left empty are filled from Media Input's data; the prompt output always "
                        "has all six, in H3 order. Also holds general params (phase, resolutions, validation mode); wire "
                        "project_folder/clip_index/previous_take to H3 Remake · Save/Load Clip Latent for clip-to-clip "
                        "continuity (can't be on this node: it would make a dependency cycle).",
            inputs=[
                io.String.Input("data", force_input=True, optional=True,
                                tooltip="Media Input's data: supplies subject_definitions and retention_analysis, "
                                        "and the reference chips shown in the editor."),
                PromptData.Input("prompt_data", extra_dict={"default_user_prompt": DEFAULT_USER_PROMPT}),
            ],
            outputs=[
                io.String.Output(id="prompt", display_name="prompt",
                                 tooltip="The chosen clip's six H3 sections, from its selected version (A or B) and data."),
                io.Int.Output(id="length", display_name="length",
                              tooltip=f"The chosen clip's duration in frames at {FPS} fps, for MiniMaxH3ReferenceToVideo's length."),
                io.Int.Output(id="width", display_name="width",
                             tooltip="Base resolution width, from the general params' aspect ratio and megapixels "
                                     "(same formula as the core Resolution Selector node)."),
                io.Int.Output(id="height", display_name="height", tooltip="Base resolution height, same source as width."),
                io.Boolean.Output(id="two_phase", display_name="two_phase",
                                  tooltip="Whether the general params ask for a second, upscale phase."),
                io.Int.Output(id="upscale_width", display_name="upscale_width",
                             tooltip="Upscale phase width, from the general params' aspect ratio and upscale megapixels "
                                     "(meaningful only when two_phase is on)."),
                io.Int.Output(id="upscale_height", display_name="upscale_height",
                             tooltip="Upscale phase height, same source as upscale_width."),
                io.String.Output(id="project_folder", display_name="project_folder",
                                 tooltip="The general params' project folder, for H3 Remake · Clip Latent."),
                io.Int.Output(id="clip_index", display_name="clip_index",
                             tooltip="The chosen clip's 1-based position, for H3 Remake · Clip Latent."),
                io.Int.Output(id="previous_take", display_name="previous_take",
                             tooltip="Which take of the PREVIOUS clip H3 Remake · Load Clip Latent should load: the "
                                     "selected take (validation: manual) or the latest one (validation: auto), as "
                                     "clip_{clip_index-1}_take_{previous_take}.latent. 0 (nothing to load) for the "
                                     "first clip, or in manual mode when no take is selected yet."),
            ],
        )

    @classmethod
    def execute(cls, prompt_data, data=None) -> io.NodeOutput:
        state = json.loads(prompt_data) if prompt_data else {}
        # A prompt saved before clips existed is a single clip.
        clips = state.get("clips") if "clips" in state else [state]
        index = next((i for i, c in enumerate(clips) if c.get("id") == state.get("selected")), 0 if clips else -1)
        clip = clips[index] if index >= 0 else None
        if clip is None:
            raise ValueError("H3 Remake · Prompt has no clip: add one in the node")
        user = clip.get("user_b") if clip.get("variant") == "b" else clip.get("user_a")
        user = DEFAULT_USER_PROMPT if user is None else user
        length = max(1, round(float(clip.get("duration", 5)) * FPS))

        general = state.get("general") or {}
        aspect_ratio = general.get("aspect_ratio") or "16:9 (Widescreen)"
        width, height = _resolution(aspect_ratio, float(general.get("megapixels") or 1.0))
        two_phase = bool(general.get("two_phase"))
        upscale_width, upscale_height = _resolution(aspect_ratio, float(general.get("upscale_megapixels") or 4.0))
        project_folder = general.get("project_folder") or ""
        manual = general.get("validation") != "auto"

        clip_number = index + 1
        previous_take = 0
        if index > 0:
            previous_generations = clips[index - 1].get("generations") or []
            if manual:
                active_id = clips[index - 1].get("activeGeneration")
                active = next((g for g in previous_generations if g.get("id") == active_id), None)
                previous_take = int(active["take"]) if active else 0
            else:
                previous_take = max((int(g.get("take", 0)) for g in previous_generations), default=0)
        if manual and index > 0 and previous_take == 0:
            raise ValueError(f"H3 Remake · Prompt: clip {index} needs a take selected as valid before generating "
                             f"clip {clip_number} (validation: manual). Select one, or switch to auto.")

        # The editor fills its empty sections from these once the run is done (web/h3remake_prompt.js).
        return io.NodeOutput(assemble_prompt(user, data), length, width, height, two_phase, upscale_width, upscale_height,
                             project_folder, clip_number, previous_take,
                             ui={"h3remake_data": [json.dumps(data_sections(data))]})


class H3RemakeSaveClipLatent(io.ComfyNode):
    """Save the clip's latent. A pure sink: nothing needs its output, so it can't be part of a cycle."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="H3RemakeSaveClipLatent",
            display_name="H3 Remake · Save Clip Latent",
            category="H3VideoRemake",
            is_output_node=True,
            description="Place after the sampler. Every run is a new take: saves the clip's latent to "
                        "project_folder/clip_N_take_K.latent (K auto-numbered) and, if connected, records every file "
                        "the video-save node wrote for it. Wire project_folder/clip_index from H3 Remake · Prompt, and "
                        "video_filenames directly from VHS_VideoCombine's Filenames output (not through "
                        "VHS_SelectFilename, which would only keep one of its files).",
            inputs=[
                io.Latent.Input("latent", tooltip="This clip's generated latent, from the sampler."),
                VhsFilenames.Input("video_filenames", optional=True,
                                   tooltip="This take's saved files (VHS_VideoCombine's Filenames output), for the "
                                           "clip's take list and for Delete others to clean up every one of them. "
                                           "Optional: the take is still recorded without it."),
                io.String.Input("project_folder", force_input=True, tooltip="From H3 Remake · Prompt's project_folder."),
                io.Int.Input("clip_index", force_input=True, tooltip="From H3 Remake · Prompt's clip_index."),
            ],
            outputs=[],
        )

    @classmethod
    def execute(cls, latent, project_folder, clip_index, video_filenames=None) -> io.NodeOutput:
        if not project_folder:
            return io.NodeOutput()
        take = next_take_number(project_folder, clip_index)
        save_clip_latent(project_folder, clip_index, take, latent)
        # VHS_VideoCombine's own paths are absolute; the frontend's /view thumbnail and player need ones
        # relative to output/, which is what it actually serves files from.
        video_paths = [relative_to_output(p) for p in (video_filenames[1] if video_filenames else [])]
        # Lets a connected Prompt node add this take to the clip's list right away, without re-running Prompt.
        # project_folder rides along so Prompt can match on it even through Get/Set reroutes, where tracing
        # the actual graph link back to Prompt wouldn't resolve to it.
        return io.NodeOutput(ui={"h3remake_saved": [json.dumps({
            "project_folder": project_folder, "clip_index": clip_index, "take": take, "video_paths": video_paths})]})


class H3RemakeLoadClipLatent(io.ComfyNode):
    """Load the previous clip's saved latent. Only reads Prompt's outputs and a file, so it can safely feed
    the sampler without ever depending on this run's own sampler output (no cycle)."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="H3RemakeLoadClipLatent",
            display_name="H3 Remake · Load Clip Latent",
            category="H3VideoRemake",
            description="Place before the sampler, for the clip's init/continuity latent. Loads the take "
                        "previous_take of the PREVIOUS clip. Wire project_folder/clip_index/previous_take from "
                        "H3 Remake · Prompt (not the sampler's own latent output: that would make a dependency cycle "
                        "through this same clip's generation).",
            inputs=[
                io.String.Input("project_folder", force_input=True, tooltip="From H3 Remake · Prompt's project_folder."),
                io.Int.Input("clip_index", force_input=True, tooltip="From H3 Remake · Prompt's clip_index (this clip; "
                                                                     "the previous one's file, clip_index - 1, is loaded)."),
                io.Int.Input("previous_take", force_input=True,
                            tooltip="From H3 Remake · Prompt's previous_take. 0 means nothing to load."),
            ],
            outputs=[
                io.Latent.Output(id="continuity_latent", display_name="continuity_latent",
                                 tooltip="The previous clip's selected take's saved latent, or empty if previous_take is 0."),
            ],
        )

    @classmethod
    def execute(cls, project_folder, clip_index, previous_take) -> io.NodeOutput:
        continuity = None
        if previous_take > 0 and project_folder and clip_index > 1:
            continuity = load_clip_latent(project_folder, clip_index - 1, previous_take)
        return io.NodeOutput(continuity)


# No custom "Gate" node here: ExecutionBlocker blocks every downstream consumer unconditionally, even one
# that treats the input as optional (like MiniMaxH3MotionContext's context_latent) - there's no way to skip
# just the branch feeding an optional input while letting the consumer keep running. The core "If/Else
# Switch" node (comfy_extras/nodes_logic.py, ComfySwitchNode) is the right tool: its unused branch is
# genuinely never evaluated (true laziness, not a blocked marker), and the chosen output is a plain value -
# see README's "Skipping a previous-clip-only branch" section.


NODES = [H3RemakeMediaInput, H3RemakeImageAggregator, H3RemakeAudioAggregator, H3RemakePrompt,
         H3RemakeSaveClipLatent, H3RemakeLoadClipLatent]
