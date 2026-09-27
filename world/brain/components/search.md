---
type: concept
title: Search
---
Search indexes projects, tasks and docs per workspace. Part of [[lumen]].

## House rules
- Every query is scoped by `workspace_id` inside the index query itself. Never post-filter results in the app. See [[rules/search-tenant-scope]].
- Archived items stay in the index with `archived: true` and are filtered in the query.
- Reindex jobs run per workspace, never globally during business hours.

## Gotchas
- The cached "recent results" path skipped the workspace filter; always check both the live and the cached path.
- Fuzzy matching must not widen the workspace scope.

## Open issues
[[issues/lum-108]], [[issues/lum-109]]
