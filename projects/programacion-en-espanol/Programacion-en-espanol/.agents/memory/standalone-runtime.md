---
name: Standalone generated HTML runtimes
description: Avoid build-tool helper references when serializing bundled functions into exported HTML.
---

Standalone HTML generated from a function's `toString()` may include build-tool-injected helpers (such as esbuild's `__name`) that are not present in the exported page. Embed a self-contained source string or explicitly include every required helper.

**Why:** A Vite/esbuild-transformed runtime failed in exported HTML because its serialized function referenced an injected helper. Typechecking and the in-app preview did not catch the missing dependency.

**How to apply:** For any function-to-source export, inspect the emitted script and run the actual HTML in a browser with interaction and persistence checks.