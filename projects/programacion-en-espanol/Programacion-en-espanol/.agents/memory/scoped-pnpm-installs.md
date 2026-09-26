---
name: Scoped pnpm installs
description: Avoid root-targeted dependency installs in this pnpm monorepo.
---

**Rule:** Add dependencies to the owning package with a pnpm workspace filter, such as `pnpm --filter @workspace/<artifact> add <package>`.

**Why:** A root-level install helper targeted the workspace root and failed with `ERR_PNPM_ADDING_TO_ROOT`, while the package-scoped command succeeded.

**How to apply:** When a dependency belongs to one artifact, scope installation to that artifact rather than retrying the same root-level helper.