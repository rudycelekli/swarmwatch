---
description: Auto-detect agent source, write SwarmWatch config, and scaffold process-live or stream-live command.
argument-hint: "[--command \"node agent.js\"] [--agent AGENT_ID] [--root DIR] [--json]"
---
Run the SwarmWatch onboarding helper from the plugin:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/swarmwatch-plugin.mjs" init $ARGUMENTS
```

Keep the live-mode wording precise in your response: process-live means `swarmwatch run` launched the command; stream-live means `swarmwatch attach` follows a growing event stream. Do not imply injection-live introspection.
