---
type: concept
title: "Rule: billing idempotency key"
---
House rule of [[components/billing]]: the idempotency key for a charge is `inv_<invoiceId>` only, and for a refund `ref_<invoiceId>` only. Retries must reuse the key. Adding the attempt number or a timestamp makes every retry a new charge.
