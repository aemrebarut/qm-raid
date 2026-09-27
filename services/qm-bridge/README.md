# qm-bridge

Implements the Bridge API (docs/CONTRACT.md) on 127.0.0.1:4614 against a local QM dev instance: one QM session per unit, run events streamed as Bridge events on GET /events, GBrain MCP tool calls normalized to `gbrain.<op>`.

Run: `cp .env.example .env` (fill locally, never commit), then `bun run dev`. Smoke: `bun run smoke` (one QM turn), `bun run bridge-smoke` (Bridge API end to end).

Plan and QM API notes: docs/lanes/qm-plan.md.
