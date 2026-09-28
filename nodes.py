from __future__ import annotations

import json
import logging

from comfy_api.latest import io

from .describe import describe_image
from .media import MAX_AUDIOS, MAX_IMAGES, build_media
from .prompt import build_prompt_data
from .prompt_sections import DEFAULT_USER_PROMPT, assemble_prompt, data_sections

# Rendered by web/h3remake_media.js; the value is the JSON state of the picker.
MediaData = io.Custom("H3REMAKE_MEDIA_DATA")
# Rendered by web/h3remake_prompt.js; the value is {"variant": "a"|"b", "user_a", "user_b"} as JSON.
PromptData = io.Custom("H3REMAKE_PROMPT_DATA")


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


class H3RemakePrompt(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="H3RemakePrompt",
            display_name="H3 Remake · Prompt",
            category="H3VideoRemake",
            description="Edit the clip's six H3 prompt sections (A/B versions). Sections left empty are filled from "
                        "Media Input's data; the prompt output always has all six, in H3 order.",
            inputs=[
                io.String.Input("data", force_input=True, optional=True,
                                tooltip="Media Input's data: supplies subject_definitions and retention_analysis, "
                                        "and the reference chips shown in the editor."),
                PromptData.Input("prompt_data", extra_dict={"default_user_prompt": DEFAULT_USER_PROMPT}),
            ],
            outputs=[
                io.String.Output(id="prompt", display_name="prompt",
                                 tooltip="The six H3 sections from the selected user prompt (A or B) and data."),
            ],
        )

    @classmethod
    def execute(cls, prompt_data, data=None) -> io.NodeOutput:
        state = json.loads(prompt_data) if prompt_data else {}
        user = state.get("user_b") if state.get("variant") == "b" else state.get("user_a")
        user = DEFAULT_USER_PROMPT if user is None else user
        # The editor fills its empty sections from these once the run is done (web/h3remake_prompt.js).
        return io.NodeOutput(assemble_prompt(user, data), ui={"h3remake_data": [json.dumps(data_sections(data))]})


NODES = [H3RemakeMediaInput, H3RemakeImageAggregator, H3RemakeAudioAggregator, H3RemakePrompt]
