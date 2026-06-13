# Security Policy

SwarmWatch is a local-first operator tool for agent runs. Security-sensitive defaults are part of the release gate, not optional hardening.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for <https://github.com/rudycelekli/swarmwatch> when available, or open a minimal public issue that asks for a private contact path without including exploit details.

Include:

- affected SwarmWatch version or commit,
- reproduction steps,
- whether the issue requires local access,
- whether untrusted transcript/event content is involved,
- expected impact.

## Security posture

- The HTTP server binds to `127.0.0.1`.
- Mutating HTTP endpoints require the per-server `x-swarmwatch-token` and reject cross-origin mutation attempts.
- The dashboard treats event-controlled strings as untrusted text.
- Transcript imports redact raw/message payloads by default.
- OpenInference/OTLP imports keep trace/span identifiers by default, but store generic model output text only with `--include-text` and raw spans only with `--include-raw`.
- `swarmwatch kill` is a local kill-request marker for external sources; only processes launched by `swarmwatch run` are eligible for supervised termination.
