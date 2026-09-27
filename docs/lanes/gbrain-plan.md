# GBrain lane plan (raid-gbrain, solo; reviewer raid-rev)

## M1 (15:05) done
1. Lumen world pages in world/brain (4 components with house rules, 3 rule pages, 9 issues, 5 companies, 5 contacts), imported and links extracted. Check: 27 pages, 76 links.
2. world/layout.json (24x24 zones, Library 11,11, Barracks 20,20, Forge 3,20, target tiles). Check: GET /world.
3. services/brain on 4616 over one `gbrain serve` child (single DB owner). Check: `bun run test`.

## M2 (15:25)
4. MCP facade on 4617/mcp for QM agents (done early, agreed with raid-qm-plan). Check: tools/list and a tools/call recall via curl.
5. Verify a real QM agent calls gbrain_recall and gbrain_remember through qm-bridge; tune tool descriptions if agents skip them. Check: learning page appears in /graph.
6. Learning pages linked to issue, component, unit; recall includes past learnings (component scoped). Check: remember on t101 then recall on t102 returns it.

## M3 (15:45)
7. /graph shaped for the Library panel (node types component, issue, company, person, rule, learning, unit; hide smoke leftovers). /search snippets.
8. Demo story: wave 1 on LUM-101 learns the idempotency rule, wave 2 on LUM-102 (refunds) recalls it. Script it in world/demo.md.

## M4 / M5
9. POST /reset and world/reset.sh: drop learnings and units pages, re-put world pages, keep one DB owner. Check twice in a row.
10. Richer world if time (more learnings seeds, timeline).
