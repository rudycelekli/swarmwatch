---
description: Start a process-live SwarmWatch supervised run and dashboard.
argument-hint: "--agent AGENT_ID -- <command...>"
---
Run the existing SwarmWatch CLI unchanged through the plugin wrapper:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/swarmwatch-plugin.mjs" run $ARGUMENTS
```

This is process-live: SwarmWatch launches the child process, so a kill marker for that agent can terminate that supervised child. Do not describe this as attaching to an arbitrary already-running session.
