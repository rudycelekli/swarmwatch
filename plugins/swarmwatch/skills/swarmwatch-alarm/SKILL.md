---
name: swarmwatch-alarm
description: React only to SwarmWatch structural alarm notifications from the plugin monitor. Use when a monitor notification starts with "SwarmWatch alert:". Stay silent for healthy runs and never invent replay-mode stuck/dead alarms.
---

# SwarmWatch Alarm Skill

Use this skill only for notifications emitted by the SwarmWatch plugin monitor.

Rules:
- Healthy swarm: say nothing.
- No active SwarmWatch run/attach session: say nothing.
- New structural alert (`runaway_cost`, `circular_delegation`, `high_fanout`): surface one concise alert with the agent/ids involved.
- Frequency cap is enforced by the monitor; do not re-nag unless a new distinct alert arrives.
- Do not surface `stuck_agent` or `dead_agent` for replay/static transcripts. Those alerts are live-only in SwarmWatch core.
- Preserve honest kill scope:
  - process-live (`swarmwatch run`) may terminate the supervised child via `/swarmwatch:swarmwatch-kill <agent>`.
  - stream-live/external attach emits a kill-request marker only and does not kill arbitrary external processes.

Response shape when a notification arrives:
`SwarmWatch: <kind> for <agent/ids>. Evidence: <short evidence>. Action: <kill action if process-live, otherwise marker-only note>.`
