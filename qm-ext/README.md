# qm-ext: the QM Raid extension for QM

Installs into a QM instance as shipped, with no QM core changes and no secrets held by us:
- MCP server `gbrain`: the GBrain facade from services/brain (http://127.0.0.1:4617/mcp, auth none). QM agents then call `gbrain_recall`, `gbrain_remember`, `gbrain_search`, `gbrain_get_page`, `gbrain_add_link` as their own tools. QM registers MCP servers only through core `PUT /v1/admin/mcp-servers/:id`, which accepts agent capability auth, so the installer asks a QM agent running as the admin to make that call from its sandbox.
- Skill pack: this repo, pinned to a commit, importing `qm-ext/skills/*/SKILL.md` through the admin skill-pack API (relayed by the local portal). The `raid-board` skill teaches agents the board's order header, the recall, decide, remember loop and the reply format.

Install (local dev instance, portal on loopback): `bun qm-ext/install.ts` (or `--skip-mcp`, `--skip-skills`). The skill pack ref must be a commit pushed to GitHub (default: git HEAD).

Env: `QM_PORTAL_URL` (default http://localhost:8129), `GBRAIN_MCP_URL`, `RAID_REPO_URL`, `RAID_REF`.
