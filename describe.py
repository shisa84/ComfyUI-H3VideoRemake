"""One-sentence descriptions of subject reference images with the in-graph vision LLM (use_llm=on).

Same approach as ComfyUI-H3LookSheets' "Describe Reference": core TextGenerate with a fixed system
prompt per subject kind, retried with a new seed on an empty reply, a refusal, a leaked chat role tag
or a rambling answer, then one last try with a softer fallback prompt. The outfit prompt is
LookSheets' verbatim, the person prompt is LookSheets' plus the outfit worn; the other kinds follow the same pattern.
"""

from __future__ import annotations

import logging
import re

import torch

from comfy_extras.nodes_textgen import TextGenerate

DESCRIBE_PROMPTS = {
    # LookSheets' person prompt, but the subject keeps the outfit worn in the photo, so it is described too.
    "person": (
        "Analyzes the person's apparent gender (man or woman), physical "
        "appearance face, hair, eyes, skin, body shape and outfit, clothing "
        "and accessories from the provided image, and ignore the background "
        "or setting entirely. \n"
        "Short description, 2 to 3 sentences."
    ),
    "outfit": (
        "Analyzes the outfit, only describe the outfit, specifically "
        "detailing the clothing and accessories, skip hair description. "
        "Very short description, only 1 sentence"
    ),
    "animal": (
        "Analyzes the animal in the provided image: species or breed, fur or skin "
        "color and markings, size and build, ignore the background or setting entirely. \n"
        "Very short description, only 1 sentence."
    ),
    "object": (
        "Analyzes the main object in the provided image: what it is, its shape, "
        "materials, colors and notable details, ignore the background or setting entirely. \n"
        "Very short description, only 1 sentence."
    ),
    "vehicle": (
        "Analyzes the vehicle in the provided image: type, make and model if recognizable, "
        "body shape, color and notable details, ignore the background or setting entirely. \n"
        "Very short description, only 1 sentence."
    ),
    "location": (
        "Analyzes the place shown in the provided image: type of place, architecture, "
        "layout, materials, lighting and key props, ignore any people. \n"
        "Very short description, only 1 sentence."
    ),
    "auto": (
        "Identifies the main subject of the provided image (a person, animal, object, "
        "outfit, vehicle or place) and its key visual features. \n"
        "Very short description, only 1 sentence."
    ),
}

# The person prompt's "physical appearance ... body shape" wording is the likely refusal trigger,
# so its fallback drops it (LookSheets' _PERSON_FALLBACK_PROMPT).
FALLBACK_PROMPTS = {
    "person": (
        "Briefly describe whether this person appears to be a man or a woman, "
        "plus their hair (color and style), eye color and what they are wearing. "
        "One short sentence only, no explanation."
    ),
}
FALLBACK_NOUNS = {"outfit": "outfit", "animal": "animal", "object": "main object", "vehicle": "vehicle",
                  "location": "place", "auto": "main subject"}

# A real one-sentence description never contains these (refusals, apologies, copyright objections).
_REFUSAL_PATTERN = re.compile(
    r"\b(i can'?t|i cannot|i'?m (unable|sorry|not able)|i am (unable|not able)|"
    r"as an ai|i must (decline|respect)|i won'?t|i apologize|unfortunately,? i|"
    r"cannot fulfill|can'?t fulfill|due to copyright|intellectual property|"
    r"copyrighted content)\b",
    re.IGNORECASE,
)
# Past this, a small VLM is reasoning out loud instead of answering. A person gets 2-3 sentences
# (appearance and outfit), every other kind one.
_MAX_REASONABLE_LENGTH = 320
_MAX_REASONABLE_LENGTH_PERSON = 900
# Small chat models sometimes echo the template's role tag as text.
_LEADING_ROLE_TAG = re.compile(r"^\s*(assistant|system|user)\s*[:\n]+\s*", re.IGNORECASE)

MAX_RETRIES = 3
_RETRY_SEED_STRIDE = 104729  # large prime, just to jump seeds


def _is_bad_output(text: str, max_chars: int) -> bool:
    text = text.strip()
    return not text or bool(_REFUSAL_PATTERN.search(text)) or len(text) > max_chars or text.count("\n") >= 2


def _sampling(seed: int) -> dict:
    # TextGenerate's "on" defaults; sampling must be on for seed retries to change anything.
    return {"sampling_mode": "on", "temperature": 0.7, "top_k": 64, "top_p": 0.95, "min_p": 0.05,
            "repetition_penalty": 1.05, "seed": seed}


def _generate(clip, prompt: str, image: torch.Tensor, max_length: int, seed: int, max_chars: int, log: list[str]) -> str:
    """One prompt, retried with new seeds; empty string when every try is unusable.
    Appends the prompt and every raw reply to `log` for the debug output."""
    log += ["--- prompt ---", prompt, "--- raw output(s) ---"]
    for attempt in range(MAX_RETRIES + 1):
        attempt_seed = (seed + attempt * _RETRY_SEED_STRIDE) % 0xffffffffffffffff
        raw = TextGenerate.execute(clip, prompt, max_length, _sampling(attempt_seed), image=image).args[0]
        log.append(f"  attempt {attempt} (seed {attempt_seed}): {raw!r}")
        text = _LEADING_ROLE_TAG.sub("", raw, count=1).strip()
        if not _is_bad_output(text, max_chars):
            return text
        logging.warning("[H3VideoRemake] unusable description (seed %s): %r, retrying", attempt_seed, raw[:120])
    return ""


def describe_image(clip, kind: str, image: torch.Tensor, max_length: int, seed: int) -> tuple[str, str]:
    """(description, debug log); the description is empty when every try failed."""
    log: list[str] = []
    max_chars = _MAX_REASONABLE_LENGTH_PERSON if kind == "person" else _MAX_REASONABLE_LENGTH
    text = _generate(clip, DESCRIBE_PROMPTS[kind], image, max_length, seed, max_chars, log)
    if not text:
        fallback = FALLBACK_PROMPTS.get(kind) or f"Briefly describe the {FALLBACK_NOUNS[kind]} in this image. One short sentence only, no explanation."
        logging.warning("[H3VideoRemake] %s prompt gave no usable description, retrying with a simpler prompt", kind)
        text = _generate(clip, fallback, image, max_length, seed, max_chars, log)
    if not text:
        logging.warning("[H3VideoRemake] no usable %s description for this image, leaving it out", kind)
    log += ["--- kept ---", text or "(none, left out)"]
    return text, "\n".join(log)
