---
type: concept
title: Billing
---
Billing charges cards through the payment provider, issues invoices and handles plan changes. Part of [[lumen]].

## House rules
- Idempotency key for every charge is `inv_<invoiceId>` and nothing else. Never include the attempt number, a timestamp or a random suffix: the retry worker reuses the key so the provider dedupes the charge. See [[rules/billing-idempotency]].
- Money is integer cents everywhere. Never use floats. Round half to even, only at the final line item.
- Proration is computed in the account's billing timezone (`account.billing_tz`), never in UTC.
- Refunds go through the same charge client as payments, so they need the same idempotency rule (key `ref_<invoiceId>`).

## Gotchas
- The retry worker (`jobs/charge_retry`) runs 3 attempts at 1, 5 and 30 minutes. A new key per attempt is the classic double-charge bug.
- Invoice PDFs read the currency symbol from the account locale, not from the invoice currency.

## Open issues
[[issues/lum-101]], [[issues/lum-102]], [[issues/lum-103]]
