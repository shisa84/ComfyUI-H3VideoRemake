// "H3 Remake · Save Clip Latent" runs after the sampler, so a connected Prompt node can't just see the
// save by re-executing itself (Prompt runs first in the same queue). Instead, broadcast the save the same
// way Media Input tells Prompt about `data` (see h3remake_media.js): a window event Prompt listens for.
import { app } from "../../scripts/app.js";

const NODE_NAME = "H3RemakeSaveClipLatent";

app.registerExtension({
  name: "H3VideoRemake.SaveClipLatent",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);
      const raw = output?.h3remake_saved?.[0];
      if (!raw) return;
      const { project_folder, clip_index, take, video_paths } = JSON.parse(raw);
      window.dispatchEvent(new CustomEvent("h3remake:latent-saved",
        { detail: { node: this, project_folder, clip_index, take, video_paths } }));
    };
  },
});
