"""subject_definitions / retention_analysis prompt sections built from the Media Input subjects.

Wording follows the H3 full-reference rewrite rules used by ComfyUI-Easy-Media (utils/prompt_builder.py,
sections 2 and 4). No image is analysed here, so each line is a template driven by the subject's kind.
"""

from __future__ import annotations

from .media import RefMedia
from .prompt_sections import SECTION_ORDER

# kind -> (what the subject is, what must be kept)
SUBJECT_TEMPLATES = {
    "auto": ("the subject", "preserving its visual appearance"),
    "person": ("the person", "preserving their facial identity, hair, body proportions and outfit"),
    "animal": ("the animal", "preserving its species or breed, fur or markings and proportions"),
    "object": ("the object", "preserving its shape, materials, colors and details"),
    "outfit": ("the outfit", "preserving its cut, fabrics, colors and accessories"),
    "vehicle": ("the vehicle", "preserving its model, body shape, colors and markings"),
    "location": ("the environment", "preserving its layout, architecture, lighting and key props"),
}


def _join(labels: list[str]) -> str:
    return labels[0] if len(labels) == 1 else ", ".join(labels[:-1]) + " and " + labels[-1]


def _audio_lines(audio: str, kind: str, subjects: str) -> tuple[str, str]:
    """(definition, retention) for one <Audio N> bound to subjects of the given kind."""
    if kind == "person":
        return (f"{audio} is the voice-timbre reference for {subjects}, providing the target speaker's vocal timbre, pitch, and delivery style.",
                f"{audio}: reference - the target speaker's voice timbre and delivery follow {audio} without copying any original recorded dialogue.")
    if kind == "location":
        return (f"{audio} is the ambient-sound reference for {subjects}, providing the environment's soundscape, texture, and atmosphere.",
                f"{audio}: reference - the ambient soundscape follows {audio} without copying the original signal.")
    return (f"{audio} is the sound reference for {subjects}, providing its characteristic voice or sound texture.",
            f"{audio}: reference - the sound of {subjects} follows {audio} without copying the original signal.")


def _sentence(text: str) -> str:
    text = text.strip()
    return text if text.endswith((".", "!", "?")) else text + "."


def build_prompt_data(media: RefMedia, descriptions: dict[tuple[int, int], str] | None = None) -> dict[str, str]:
    """`descriptions` (use_llm=on) maps (subject number, image number) to a one-sentence LLM description,
    appended to that subject's definition; without it the definitions are the kind templates alone."""
    definitions, retention = [], []
    audio_subjects: dict[int, list] = {}  # <Audio N> index -> subjects using it
    audio_tags = {a.number: i for i, a in enumerate(media.active_audios(), 1)}

    for s in media.subjects:
        what, keep = SUBJECT_TEMPLATES[s.kind]
        pictures = _join([f"<Picture {n}>" for n in s.images])
        definition = f"<Subject {s.number}> is {what} from the reference {pictures}, {keep}."
        described = [(n, descriptions.get((s.number, n))) for n in s.images] if descriptions else []
        described = [(n, d) for n, d in described if d]
        if len(s.images) == 1 and described:
            definition += " " + _sentence(described[0][1])
        else:
            definition += "".join(f" <Picture {n}>: {_sentence(d)}" for n, d in described)
        definitions.append(definition)
        retention.append(f"<Subject {s.number}> (appears in [Shot 1]): fully_preserved")
        if s.audio in audio_tags:
            audio_subjects.setdefault(audio_tags[s.audio], []).append(s)

    for tag in range(1, len(audio_tags) + 1):
        audio = f"<Audio {tag}>"
        users = audio_subjects.get(tag)
        if not users:
            definitions.append(f"{audio} is an audio reference for the target video.")
            retention.append(f"{audio}: reference - the target audio follows {audio} without copying the original signal.")
            continue
        # A shared audio takes the role of its first subject's kind.
        definition, kept = _audio_lines(audio, users[0].kind, _join([f"<Subject {s.number}>" for s in users]))
        definitions.append(definition)
        retention.append(kept)

    filled = {"subject_definitions": "\n".join(definitions), "retention_analysis": "\n".join(retention)}
    # All six sections, in H3 order; the ones Media Input can't write stay empty for the Prompt node.
    return {name: filled.get(name, "") for name in SECTION_ORDER}
