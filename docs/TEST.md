# How to test each milestone (lanes append here)

## M1 river (forge, 4612)
`cd services/forge && bun run dev`, then `bun run smoke` (PASS). Manual: `curl -s -XPOST 127.0.0.1:4612/types -H 'content-type: application/json' -d '{"name":"Refund Ranger","description":"triages billing refund bugs and replies in the house tone"}'` then `curl -s 127.0.0.1:4612/types` a few times: status goes generating, training, evaluating, ready over about 60 s (dry run: model dry-run:<id>, evalScore null). Synthetic data lands in river/runs/<id>/train.jsonl.
