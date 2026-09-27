# QM Raid

An RTS-style agent board for [QM](https://github.com/yc-software/qm) swarms, with [GBrain](https://github.com/garrytan/gbrain) as the shared memory the agents consult and grow.

Issues appear as targets on a 2.5D isometric map, agents are units you select, group and order like an RTS, and GBrain is the Library building: agents raise their staffs to recall from it and send learnings back into it. The Forge is a River building: describe a new kind of agent, it generates synthetic training data, fine-tunes a model with River, and you train units of that new type from it. Autopilot proposes orders with a short veto window.

Built during the Own Your Intelligence Hackathon (YC, San Francisco, 2026-09-27) by a swarm of coding agents. See `docs/` for the plan and the contract between services, and `services/` and `apps/` for the components. All data is synthetic.
