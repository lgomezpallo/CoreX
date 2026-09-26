---
name: Python in browser workers
description: Build and runtime constraints for loading Pyodide inside Vite module workers.
---

For a browser-hosted Python IDE, dynamically import Pyodide's browser `pyodide.mjs` from a module worker and pass the same versioned CDN `indexURL` to `loadPyodide`. Avoid statically bundling the npm package into the worker: Vite may traverse Node-only fallbacks, externalize `node:*` modules, or require unsupported worker code splitting.

**Why:** A static import failed the production worker build because Vite defaulted to IIFE output while Pyodide includes Node support. The browser runtime also needs the matching CDN assets.

**How to apply:** Keep worker output set to ES modules, keep Pyodide imports type-only, and verify the versioned `pyodide.mjs` and WebAssembly files remain accessible from the CDN when changing versions.