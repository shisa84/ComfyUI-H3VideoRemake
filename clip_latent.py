from __future__ import annotations

import os

import comfy.nested_tensor
import comfy.utils
import folder_paths
import safetensors.torch
import torch


def _clip_latent_path(project_folder: str, clip_index: int) -> str:
    """project_folder/clip_NNN.latent, confined to ComfyUI's output directory."""
    base = os.path.abspath(folder_paths.get_output_directory())
    path = os.path.abspath(os.path.join(base, project_folder or "", f"clip_{clip_index:03d}.latent"))
    if os.path.commonpath([base, path]) != base:
        raise ValueError(f"project_folder escapes the output directory: {project_folder!r}")
    return path


def save_clip_latent(project_folder: str, clip_index: int, samples: dict) -> None:
    path = _clip_latent_path(project_folder, clip_index)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tensor = samples["samples"]
    if isinstance(tensor, comfy.nested_tensor.NestedTensor):
        # MiniMax H3's AV latent is a (video, audio) pair; core SaveLatent's single-tensor format has no room for that.
        output = {f"latent_tensor_{i}": part.contiguous() for i, part in enumerate(tensor.tensors)}
    else:
        output = {"latent_tensor": tensor.contiguous()}  # same key as core SaveLatent, also openable with LoadLatent
    output["latent_format_version_0"] = torch.tensor([])
    comfy.utils.save_torch_file(output, path)


def clip_latent_exists(project_folder: str, clip_index: int) -> bool:
    return os.path.isfile(_clip_latent_path(project_folder, clip_index))


def load_clip_latent(project_folder: str, clip_index: int) -> dict | None:
    path = _clip_latent_path(project_folder, clip_index)
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
