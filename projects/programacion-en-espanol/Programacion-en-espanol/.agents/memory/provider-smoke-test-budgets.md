---
name: Provider smoke-test token budgets
description: Avoid false provider outages when testing reasoning-capable OpenAI-compatible models.
---

Reasoning-capable models need realistic token and timeout budgets; a small cap or short deadline can be spent on internal reasoning and look like a provider outage. Strip reasoning markup before parsing or surfacing model output, and never include hidden reasoning in diagnostics.

Valid JSON is not enough to prove planning is reliable. A provider can pass a small planning probe but still add features the user did not request in a real generation. Advertise planning only after an end-to-end scope check; otherwise route planning through a tested provider and use the model for capabilities it handles well.

**Why:** A tiny smoke-test cap previously caused false reliability penalties, while Cloudflare's reasoning model passed a schema probe but generated unrequested integrations during a real plan. It also emits `<think>` markup and can exceed the general request timeout.

**How to apply:** Set provider-specific token/time limits when needed, strip reasoning blocks before validation, keep errors content-safe, and verify representative end-to-end outputs before marking a capability as supported.