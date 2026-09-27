---
type: concept
title: "Rule: search tenant scope"
---
House rule of [[components/search]]: scope every search query by `workspace_id` in the index query, on both the live and the cached path. Never post-filter.
