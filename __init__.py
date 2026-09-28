from comfy_api.latest import ComfyExtension

from .nodes import NODES

WEB_DIRECTORY = "./web"


class H3VideoRemakeExtension(ComfyExtension):
    async def get_node_list(self):
        return NODES


async def comfy_entrypoint() -> H3VideoRemakeExtension:
    return H3VideoRemakeExtension()
