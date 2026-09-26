---
name: Router IA Clerk environments
description: Replit-managed Clerk keeps preview and production users separate, affecting the single-owner claim flow.
---

The Router IA owner claim is per deployment environment. Replit-managed Clerk uses isolated Development and Production user stores. Signing into preview does not make that identity or owner claim available in Production; the intended owner must sign into the published app and claim Production.

**Why:** Router IA stores provider credentials and intentionally allows only one owner; publishing creates a separate authentication environment.

**How to apply:** Publish the app as private, then sign in with the intended owner before sharing access. Confirm additional accounts are denied.