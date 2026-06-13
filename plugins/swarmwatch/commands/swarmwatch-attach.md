---
description: Start a stream-live SwarmWatch follow of a growing event source.
argument-hint: "--adapter ADAPTER --file FILE [--from-start]"
---
Run the existing SwarmWatch CLI unchanged through the plugin wrapper:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/swarmwatch-plugin.mjs" attach $ARGUMENTS
```

This is stream-live: SwarmWatch follows a growing event source. It does not hook framework internals or observe silent already-running sessions.
