---
description: List or answer SwarmWatch Operator Inbox requests.
argument-hint: "list|respond REQUEST_ID [--response TEXT] [--action approve|deny|respond]"
---
Run the existing SwarmWatch CLI unchanged through the plugin wrapper:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/swarmwatch-plugin.mjs" operator $ARGUMENTS
```

This does not introspect arbitrary sessions. It reads pending `operator_request` events from the active SwarmWatch event stream and appends an auditable `operator_response`.
