---
description: Request a SwarmWatch kill for an agent with honest run-vs-attach semantics.
argument-hint: "AGENT_ID [--root DIR]"
---
Run the existing SwarmWatch CLI unchanged through the plugin wrapper:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/swarmwatch-plugin.mjs" kill $ARGUMENTS
```

If the active session is process-live, the matching supervised child can terminate. If the active session is stream-live or imported/external, this emits a kill-request marker only.
