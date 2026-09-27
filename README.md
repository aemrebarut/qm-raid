# QM Raid

An RTS-style agent board for [QM](https://github.com/yc-software/qm) swarms, with [GBrain](https://github.com/garrytan/gbrain) as the shared memory the agents consult and grow.

Issues appear as targets on a 2.5D isometric map, agents are units you select, group and order like an RTS, and GBrain is the Library building: agents raise their staffs to recall from it and send learnings back into it. Autopilot proposes orders with a short veto window, and every veto becomes training data for a small commander model trained with River.

Built during the Own Your Intelligence Hackathon (YC, San Francisco, 2026-09-27) by a swarm of coding agents. See `docs/` for the plan and the contract between services, and `services/` and `apps/` for the components. All data is synthetic.
