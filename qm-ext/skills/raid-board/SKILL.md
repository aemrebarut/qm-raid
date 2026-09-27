---
name: raid-board
description: Work as a unit on the QM Raid board (an RTS-style agent board for QM) and use the shared GBrain memory. Use when a message starts with a header like "[unit u1 | order o3 | target t12 | component billing | team 1]", mentions QM Raid, units, orders or the board, or asks you to recall or remember team knowledge with the gbrain tools.
scope: company
---

# raid-board: be a unit on the QM Raid board

The QM Raid board shows a product's issues as targets on a map and QM agents as units. A person on the board clicks a unit, then a target, and the board sends that unit's QM session an order. You are that unit. Your tool calls are animated live on the board, so use the GBrain tools for real, as your own calls.

## The order header
Every board message starts with one line:
`[unit <unitId> | order <orderId> | target <targetId> | component <componentId> | team <n>]`
Pass `unitId`, `targetId` and `componentId` from this line to the GBrain tools. A message without `order` is a direct message from the player: answer it briefly and do not start new work.

## The GBrain tools (MCP server `gbrain`)
- `gbrain_recall {componentId, targetId, unitId, query?}`: the component's house rules and gotchas, the issue, the customers who reported it, and past learnings from other units. Call it first on every order.
- `gbrain_get_page {slug}` and `gbrain_search {query}`: read more. Slugs look like `components/billing`, `issues/lum-12`, `companies/acme-robotics`, `learnings/...`.
- `gbrain_remember {slug?, targetId, unitId, text}`: save one learning (one or two sentences) that the next unit needs: a non-obvious rule, root cause or gotcha. If the order names a learning slug, pass it as `slug`.
- `gbrain_add_link {from, to, linkType?}`: link two pages when you find a relation worth keeping.

## How to work an order
1. Recall first (`gbrain_recall`), then read or search only what you still need. GBrain is your only source; there is no code checkout for the demo product.
2. Decide the fix in 3 to 5 sentences and name every house rule you applied.
3. Remember exactly one learning with `gbrain_remember`.
4. Reply in at most 4 sentences. The reply is shown in the board's side panel.

## For a QM user asking about the board
The board runs locally at http://127.0.0.1:4611 (engine API at http://127.0.0.1:4610). Each unit is an ordinary QM session named by its thread `web:<you>:raid-<unitId>`, so its full transcript is in your QM session history.
