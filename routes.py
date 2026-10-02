from __future__ import annotations

from aiohttp import web
from server import PromptServer

from .clip_latent import delete_other_takes


@PromptServer.instance.routes.post("/h3remake/delete_other_takes")
async def h3remake_delete_other_takes(request):
    data = await request.json()
    project_folder = data.get("project_folder") or ""
    clip_index = int(data.get("clip_index") or 0)
    keep_take = int(data.get("keep_take") or 0)
    video_paths = data.get("delete_video_paths") or []
    if not project_folder or clip_index < 1 or keep_take < 1:
        return web.json_response({"error": "project_folder, clip_index and keep_take are required"}, status=400)
    removed = delete_other_takes(project_folder, clip_index, keep_take, video_paths)
    return web.json_response({"removed": removed})
