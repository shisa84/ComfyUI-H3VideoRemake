from __future__ import annotations

import os
import re

import comfy.nested_tensor
import comfy.utils
import folder_paths
import safetensors.torch
import torch

_TAKE_PATTERN = re.compile(r"^clip_(\d{3})_take_(\d+)\.latent$")


def _project_dir(project_folder: str) -> str:
    """project_folder, confined to ComfyUI's output directory."""
    base = os.path.abspath(folder_paths.get_output_directory())
    path = os.path.abspath(os.path.join(base, project_folder or ""))
    if os.path.commonpath([base, path]) != base:
        raise ValueError(f"project_folder escapes the output directory: {project_folder!r}")
    return path


def relative_to_output(path: str) -> str:
    """path (absolute, e.g. from VHS_SelectFilename, or already relative) as a /-separated path relative to
    ComfyUI's output directory, for the frontend's /view?subfolder=... thumbnail and player URLs."""
    if not path:
        return ""
    base = os.path.abspath(folder_paths.get_output_directory())
    full = os.path.abspath(path) if os.path.isabs(path) else os.path.abspath(os.path.join(base, path))
    try:
        return os.path.relpath(full, base).replace(os.sep, "/")
    except ValueError:
        return path  # different drive on Windows: can't express as relative, leave as given


def _clip_latent_path(project_folder: str, clip_index: int, take: int) -> str:
    return os.path.join(_project_dir(project_folder), f"clip_{clip_index:03d}_take_{take:03d}.latent")


def next_take_number(project_folder: str, clip_index: int) -> int:
    """The next free take number for this clip: one past the highest take already on disk."""
    folder = _project_dir(project_folder)
    if not os.path.isdir(folder):
        return 1
    takes = [int(m.group(2)) for name in os.listdir(folder)
             if (m := _TAKE_PATTERN.match(name)) and int(m.group(1)) == clip_index]
    return max(takes, default=0) + 1


def save_clip_latent(project_folder: str, clip_index: int, take: int, samples: dict) -> None:
    path = _clip_latent_path(project_folder, clip_index, take)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tensor = samples["samples"]
    if isinstance(tensor, comfy.nested_tensor.NestedTensor):
        # MiniMax H3's AV latent is a (video, audio) pair; core SaveLatent's single-tensor format has no room for that.
        output = {f"latent_tensor_{i}": part.contiguous() for i, part in enumerate(tensor.tensors)}
    else:
        output = {"latent_tensor": tensor.contiguous()}  # same key as core SaveLatent, also openable with LoadLatent
    output["latent_format_version_0"] = torch.tensor([])
    comfy.utils.save_torch_file(output, path)


def load_clip_latent(project_folder: str, clip_index: int, take: int) -> dict | None:
    path = _clip_latent_path(project_folder, clip_index, take)
    if not os.path.isfile(path):
        return None
    raw = safetensors.torch.load_file(path, device="cpu")
    multiplier = 1.0 if "latent_format_version_0" in raw else 1.0 / 0.18215
    if "latent_tensor" in raw:
        samples = raw["latent_tensor"].float() * multiplier
    else:
        parts = sorted((k for k in raw if k.startswith("latent_tensor_")), key=lambda k: int(k.rsplit("_", 1)[1]))
        samples = comfy.nested_tensor.NestedTensor([raw[k].float() * multiplier for k in parts])
    return {"samples": samples}


def delete_other_takes(project_folder: str, clip_index: int, keep_take: int, video_paths: list[str]) -> int:
    """Delete every other take's latent for this clip, plus the given video files. Both confined to output/."""
    removed = 0
    folder = _project_dir(project_folder)
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            m = _TAKE_PATTERN.match(name)
            if m and int(m.group(1)) == clip_index and int(m.group(2)) != keep_take:
                os.remove(os.path.join(folder, name))
                removed += 1
    output_root = os.path.abspath(folder_paths.get_output_directory())
    for video_path in video_paths:
        full = os.path.abspath(video_path if os.path.isabs(video_path) else os.path.join(output_root, video_path))
        if os.path.commonpath([output_root, full]) == output_root and os.path.isfile(full):
            os.remove(full)
            removed += 1
    return removed
