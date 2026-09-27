# Demo story: the Library learns (raid-gbrain)

Start clean: `world/reset.sh` (27 world pages, 0 learnings, 0 units in the Library graph).

## Wave 1: learn
1. Order a knight onto **LUM-101 Payment retry double-charges a card** (t101, Billing, severity 3, reported by Acme Robotics / Maya Chen).
2. The agent calls `gbrain_recall {componentId: "billing", targetId: "t101", unitId}`: blue beam from the Library. It gets the Billing house rules (idempotency key `inv_<invoiceId>` only, retries reuse it), the LUM-101 issue and Acme Robotics.
3. It works the issue and calls `gbrain_remember {targetId: "t101", text, unitId}`: gold orb to the Library. A new `learnings/lum-101-<unit>-<ms>` node appears in the Library graph, linked to LUM-101, Billing and the unit.

## Wave 2: recall
4. Order a different unit onto **LUM-102 Prorated refunds on plan downgrade** (t102, Billing, Brightpath Clinics).
5. Its `gbrain_recall` for Billing now also returns wave 1's learning (recall includes the newest learnings for the same component). The agent applies it: refunds go through the same charge client, so the refund key is `ref_<invoiceId>` and retries reuse it.
6. It remembers its own learning; the Library graph shows two learnings on Billing, one per wave.

## What to point at
- The side panel activity feed shows the agents' own `gbrain.recall` / `gbrain.remember` tool calls (the agents use GBrain as a tool, through the brain service's MCP facade on 4617).
- Clicking the Library shows the graph growing: component, rules, issues, customers, contacts, then learnings and units.
- Other components carry their own trap for later waves: Auth clock skew (LUM-104, Northwind Freight SSO), Search tenant scope (LUM-108, archived projects leaking across workspaces).
