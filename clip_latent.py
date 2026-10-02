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


def _delete_videos(video_paths: list[str]) -> int:
    """Delete the given video files, confined to output/."""
    removed = 0
    output_root = os.path.abspath(folder_paths.get_output_directory())
    for video_path in video_paths:
        full = os.path.abspath(video_path if os.path.isabs(video_path) else os.path.join(output_root, video_path))
        if os.path.commonpath([output_root, full]) == output_root and os.path.isfile(full):
            os.remove(full)
            removed += 1
    return removed


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
    return removed + _delete_videos(video_paths)


def delete_take(project_folder: str, clip_index: int, take: int, video_paths: list[str]) -> int:
    """Delete this one take's latent, plus the given video files. Both confined to output/."""
    path = _clip_latent_path(project_folder, clip_index, take)
    removed = 1 if os.path.isfile(path) else 0
    if removed:
        os.remove(path)
    return removed + _delete_videos(video_paths)


def _video_group_base(filename: str) -> str | None:
    """filename's VHS_VideoCombine group key: the same take's keyframe .png, silent video and audio-muxed
    version all share this (e.g. "video_00014.mp4" and "video_00014-audio.mp4" both give "video_00014")."""
    stem, ext = os.path.splitext(filename)
    if not ext:
        return None
    return stem[:-len("-audio")] if stem.endswith("-audio") else stem


def _video_file_priority(filename: str) -> int:
    """VHS's own append order within a group: keyframe png, then silent video, then audio-muxed - matches
    what H3RemakeSaveClipLatent already records for a take whose event wasn't missed."""
    if filename.endswith(".png"):
        return 0
    stem, _ = os.path.splitext(filename)
    return 2 if stem.endswith("-audio") else 1


# A take's Save Clip Latent always runs right after its video-save node, in the same execution - so a take
# missing from the editor (its event was missed, e.g. the tab wasn't open) can still be matched to its video
# group by proximity: the nearest unclaimed group written just before that take's .latent file.
_RESYNC_TOLERANCE_SECONDS = 120


def resync_takes(project_folder: str, clip_index: int, known_takes: list[int], known_video_paths: list[str]) -> list[dict]:
    """Takes on disk for this clip that aren't in known_takes, with a best-effort video match for each (empty
    video_paths if none is found within tolerance) - for rebuilding the editor's take list after a missed event."""
    folder = _project_dir(project_folder)
    if not os.path.isdir(folder):
        return []
    known_takes = set(known_takes)
    known_names = {os.path.basename(p) for p in known_video_paths}

    take_mtimes: dict[int, float] = {}
    groups: dict[str, list[tuple[str, float]]] = {}
    for name in os.listdir(folder):
        full = os.path.join(folder, name)
        if not os.path.isfile(full):
            continue
        m = _TAKE_PATTERN.match(name)
        if m and int(m.group(1)) == clip_index:
            take_mtimes[int(m.group(2))] = os.path.getmtime(full)
        elif not m and name not in known_names:
            base = _video_group_base(name)
            if base is not None:
                groups.setdefault(base, []).append((name, os.path.getmtime(full)))
    group_mtimes = {base: max(mt for _, mt in files) for base, files in groups.items()}

    missing_takes = sorted(t for t in take_mtimes if t not in known_takes)
    results = []
    for take in missing_takes:
        take_mtime = take_mtimes[take]
        candidates = [base for base, mt in group_mtimes.items() if mt <= take_mtime
                     and take_mtime - mt <= _RESYNC_TOLERANCE_SECONDS]
        video_paths = []
        if candidates:
            best = max(candidates, key=lambda base: group_mtimes[base])
            files = sorted(groups.pop(best), key=lambda nm_mt: _video_file_priority(nm_mt[0]))
            del group_mtimes[best]
            video_paths = [relative_to_output(os.path.join(folder, name)) for name, _ in files]
        results.append({"take": take, "video_paths": video_paths})
    return results
