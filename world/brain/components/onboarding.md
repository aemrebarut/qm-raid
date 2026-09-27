---
type: concept
title: Onboarding
---
Onboarding creates workspaces, sends invites and runs the 14 day trial. Part of [[lumen]].

## House rules
- The trial clock starts when the first invited teammate accepts, not when the workspace is created.
- All outbound email goes through the `mailer` queue; never send inline from a request handler.
- CSV imports are validated fully before any invite is sent (all or nothing).

## Gotchas
- The mailer queue is shared with billing receipts, so a billing backlog delays invites.
- Email addresses are compared lowercase and trimmed; the CSV importer used to skip this.

## Open issues
[[issues/lum-106]], [[issues/lum-107]]
