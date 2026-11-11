# Roadmap

What is intentionally not finished yet, and why. Each item is planned as its own small pull request.

## Needs an external party first

| Item | Blocked on | Reference |
|---|---|---|
| e-Arşiv / e-Fatura / ÖKC documents | Integrator contract and sandbox credentials | [FISCAL_INTEGRATION.md](FISCAL_INTEGRATION.md) |
| Switching KDV on in production | Written confirmation of assumptions A1–A4 by a mali müşavir | [BUSINESS_RULES.md §20](../backend/BUSINESS_RULES.md) |
| MASAK identification threshold value | Compliance adviser | [BUSINESS_RULES.md §21](../backend/BUSINESS_RULES.md) |
| KVKK privacy notice text and VERBİS registration | Lawyer | [BUSINESS_RULES.md §21](../backend/BUSINESS_RULES.md) |
| Licensed market-data feeds (BIST, İZKO, …) | Data contracts | [BUSINESS_RULES.md §19](../backend/BUSINESS_RULES.md) |

## Engineering

| Item | Why it is not done yet |
|---|---|
| Branch identity phase 2: id-based ledger account codes | Phase 1 is done: a registry with stable codes and editable names. Phase 2 rewrites ledger account codes, so it needs a rehearsal on real data first ([ADR 0001](adr/0001-branch-identity.md)) |
| Move the remaining hand-written request validation to zod | The existing validation is tested; migrate one route group at a time |
| ESLint 10 | Blocked by a plugin peer dependency |

## Product

1. Pilot with one jewellery shop. Reorder this list based on what is actually used at the till.
2. Gold-denominated customer accounts (emanet / has borç) in the UI.
3. Scrap (hurda) buy-back receipts.
4. Offline-tolerant till mode for unstable connections.
