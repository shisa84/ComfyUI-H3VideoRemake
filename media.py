"""Reference media uploaded in the Media Input widget: up to 9 images, 3 audios, and the subjects built from them."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

import torch

import folder_paths
from comfy_extras.nodes_audio import load as load_audio_file
from nodes import LoadImage

MAX_IMAGES = 9  # same limits as the native MiniMaxH3ReferenceToVideo node
MAX_AUDIOS = 3
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus"}
# "auto" leaves the type to be worked out downstream. Keep in sync with SUBJECT_KINDS in web/h3remake_media.js.
SUBJECT_KINDS = ("auto", "person", "animal", "object", "outfit", "vehicle", "location")


@dataclass(frozen=True)
class RefAudio:
    number: int  # position in the widget, 1-based
    audio: dict[str, Any]  # ComfyUI AUDIO: {"waveform": [B, C, L], "sample_rate": int}
    enabled: bool


@dataclass(frozen=True)
class Subject:
    number: int  # position in the widget, 1-based
    kind: str  # one of SUBJECT_KINDS
    images: tuple[int, ...]  # image numbers, 1-based
    audio: int | None  # reference audio number, None when the subject has no voice


@dataclass(frozen=True)
class RefMedia:
    images: tuple[torch.Tensor, ...]  # image N is images[N - 1], each [1, H, W, C]
    audios: tuple[RefAudio, ...]
    subjects: tuple[Subject, ...]

    def active_audios(self) -> tuple[RefAudio, ...]:
        """Switched-on audios, in order: the one at index i is <Audio i+1>."""
        return tuple(a for a in self.audios if a.enabled)


def resolve_path(item: dict[str, Any], extensions: set[str]) -> str:
    """Absolute path of an uploaded file, confined to ComfyUI's input folder."""
    base = os.path.abspath(folder_paths.get_input_directory())
    path = os.path.abspath(os.path.join(base, str(item.get("path", ""))))
    if os.path.commonpath([base, path]) != base:
        raise ValueError(f"media path escapes the input folder: {item.get('path')!r}")
    if os.path.splitext(path)[1].lower() not in extensions:
        raise ValueError(f"unsupported file type: {item.get('path')!r}")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"input/{item.get('path')} not found; upload it again in the Media Input node")
    return path


def load_image(path: str) -> torch.Tensor:
    image, _mask = LoadImage().load_image(path)
    return image[:1]


def load_audio(path: str) -> dict[str, Any]:
    waveform, sample_rate = load_audio_file(path)
    return {"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate}


def build_media(raw: str | dict) -> RefMedia:
    data = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw or {})
    image_items = data.get("images") or []
    audio_items = data.get("audios") or []
    if len(image_items) > MAX_IMAGES:
        raise ValueError(f"at most {MAX_IMAGES} images")
    if len(audio_items) > MAX_AUDIOS:
        raise ValueError(f"at most {MAX_AUDIOS} audios")

    images = tuple(load_image(resolve_path(item, IMAGE_EXTENSIONS)) for item in image_items)
    audios = tuple(RefAudio(number=n, audio=load_audio(resolve_path(item, AUDIO_EXTENSIONS)), enabled=bool(item.get("enabled", True)))
                   for n, item in enumerate(audio_items, 1))

    # The widget links subjects to media by id so reordering or removing media keeps them consistent.
    image_numbers = {item.get("id"): n for n, item in enumerate(image_items, 1)}
    audio_numbers = {item.get("id"): n for n, item in enumerate(audio_items, 1)}
    subjects = []
    for number, item in enumerate(data.get("subjects") or [], 1):
        members = tuple(sorted(image_numbers[i] for i in item.get("image_ids") or [] if i in image_numbers))
        kind = item.get("kind", "auto")
        if kind not in SUBJECT_KINDS:
            raise ValueError(f"subject {number} has unknown kind {kind!r}; expected one of {', '.join(SUBJECT_KINDS)}")
        if not members:
            raise ValueError(f"subject {number} has no image; select at least one image for it")
        subjects.append(Subject(number=number, kind=kind, images=members, audio=audio_numbers.get(item.get("audio_id"))))
    return RefMedia(images=images, audios=audios, subjects=tuple(subjects))
