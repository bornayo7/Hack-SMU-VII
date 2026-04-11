// =============================================================================
// VisionTranslate (lensmu) — Vite Build Configuration
// =============================================================================
//
// WHY VITE FOR A BROWSER EXTENSION?
// ----------------------------------
// Browser extensions have unusual constraints compared to normal web apps:
//
//   1. Content scripts run inside the web page's context. Chrome/Firefox inject
//      them as a single <script> tag, so they MUST be a single self-contained
//      file — no dynamic imports, no code splitting, no lazy loading.
//
//   2. The popup (the small window when you click the extension icon) is a
//      normal HTML page, so it CAN use code splitting, but for simplicity we
//      keep it as a single bundle too.
//
//   3. background.js (the service worker) and content.js (the injector script)
//      are plain vanilla JavaScript — they do NOT use React or JSX, so they
//      do NOT go through Vite at all. They live in extension/src/ and are
//      referenced directly by manifest.json.
//
//   4. The content-overlay is a React component that gets injected into web
//      pages by content.js. It needs to be bundled into a single .js file
//      that content.js can load.
//
// BUILD OUTPUTS:
//   extension/dist/popup/index.html   — the popup UI (React)
//   extension/dist/popup/popup.js     — the popup JS bundle
//   extension/dist/popup/popup.css    — the popup styles
//   extension/dist/content-overlay.js — the overlay React bundle (single file)
//
// WHAT DOES NOT GO THROUGH VITE:
//   extension/src/background.js       — service worker (vanilla JS)
//   extension/src/content.js          — content script injector (vanilla JS)
//   extension/src/overlay.js          — thin bootstrap for content-overlay
//
// =============================================================================

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// =============================================================================
// Helper: determine which build target we are compiling.
//
// We use an environment variable BUILD_TARGET to switch between the two builds
// because Vite's native multi-page mode does not support mixing an HTML entry
// (popup) with a pure JS library entry (content-overlay) in one pass.
//
// Usage:
//   BUILD_TARGET=popup    npx vite build   — builds the popup UI
//   BUILD_TARGET=overlay  npx vite build   — builds the content overlay bundle
//   npm run build                          — runs BOTH sequentially (see package.json)
// =============================================================================
const buildTarget = process.env.BUILD_TARGET || "popup";

// ---------------------------------------------------------------------------
// Popup configuration
// ---------------------------------------------------------------------------
// The popup is a standard single-page React app served from dist/popup/.
// It has an HTML entry point (src/popup/index.html) that loads index.jsx.
// ---------------------------------------------------------------------------
function popupConfig() {
  return defineConfig({
    // -----------------------------------------------------------------------
    // plugins
    // -----------------------------------------------------------------------
    // @vitejs/plugin-react adds:
    //   - Automatic JSX runtime (no need to `import React` in every file)
    //   - Fast Refresh during development (hot module replacement)
    //   - Babel transforms for modern JS features
    // -----------------------------------------------------------------------
    plugins: [react()],

    // -----------------------------------------------------------------------
    // root
    // -----------------------------------------------------------------------
    // Vite uses "root" as the base directory for resolving entry points.
    // We point it at src/popup/ so that index.html there is found automatically.
    // -----------------------------------------------------------------------
    root: resolve(__dirname, "src/popup"),

    // -----------------------------------------------------------------------
    // build
    // -----------------------------------------------------------------------
    build: {
      // Where the compiled files end up. Relative to the project root (the
      // directory containing this vite.config.js), NOT relative to `root`.
      outDir: resolve(__dirname, "dist/popup"),

      // Empty the output directory before each build so stale files don't
      // linger and cause confusion.
      emptyOutDir: true,

      // ---------------------
      // rollupOptions
      // ---------------------
      // Rollup is the bundler that Vite uses under the hood. We configure it
      // to produce predictable file names (no content hashes) because the
      // manifest.json references these files by exact name.
      //
      // Why no hashes? In a normal web app, hashed filenames (app-3a7b2c.js)
      // enable aggressive caching. But browser extension manifests need stable
      // paths like "popup/popup.js", so we strip the hashes.
      // ---------------------
      rollupOptions: {
        output: {
          // JS entry file name — no hash
          entryFileNames: "popup.js",
          // JS chunk file names (if any) — no hash
          chunkFileNames: "popup-[name].js",
          // CSS and other assets — no hash
          assetFileNames: "popup.[ext]",
        },
      },

      // Disable source maps in production for smaller output. During
      // development (`npm run dev`), Vite serves with source maps by default.
      sourcemap: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Content-overlay configuration
// ---------------------------------------------------------------------------
// The content-overlay is a React component tree that renders translation
// overlays on top of images in the web page. It gets bundled into a single
// JavaScript file (dist/content-overlay.js) that the content script loads.
//
// KEY CONSTRAINT: This MUST be a single file. Chrome's content script
// injection does not support ES module imports or dynamic imports. Everything
// (React, ReactDOM, our components, CSS) must be in one bundle.
// ---------------------------------------------------------------------------
function overlayConfig() {
  return defineConfig({
    plugins: [react()],

    // -----------------------------------------------------------------------
    // build.lib — Library mode
    // -----------------------------------------------------------------------
    // We build the overlay as a "library" rather than an "app" because:
    //   - It has no HTML entry point (it gets injected into existing pages)
    //   - It needs to export nothing — it just runs and mounts React
    //   - Library mode with "iife" format produces a single self-executing file
    // -----------------------------------------------------------------------
    build: {
      outDir: resolve(__dirname, "dist"),
      emptyOutDir: false, // Don't wipe dist/ — the popup build already put files there

      lib: {
        // The React entry point for the overlay components
        entry: resolve(__dirname, "src/content-overlay/index.jsx"),

        // "iife" = Immediately Invoked Function Expression. The entire bundle
        // is wrapped in (function(){ ... })() so all variables are scoped and
        // don't pollute the web page's global namespace. This is critical
        // because content scripts share the page's JS environment.
        formats: ["iife"],

        // The output file name. The [format] placeholder is replaced by "iife".
        fileName: () => "content-overlay.js",

        // Name for the IIFE global variable. Since we don't actually need to
        // export anything (the overlay self-mounts), this is just a namespace.
        name: "VisionTranslateOverlay",
      },

      rollupOptions: {
        output: {
          // ---------------------
          // inlineDynamicImports
          // ---------------------
          // Forces ALL dynamic import() calls to be inlined into the main
          // bundle instead of creating separate chunk files. This is essential
          // because content scripts cannot load separate chunks — there's no
          // HTML page to add <script> tags to, and Chrome blocks dynamic
          // imports in content script context.
          inlineDynamicImports: true,

          // Ensure CSS is extracted as a separate file so content.js can
          // inject it into the page's Shadow DOM (to avoid style conflicts
          // with the host page's CSS).
          assetFileNames: "content-overlay.[ext]",
        },
      },

      // Inline all CSS into the JS bundle. This makes injection simpler
      // because content.js only needs to load one file. The CSS is injected
      // via <style> tags at runtime.
      cssCodeSplit: false,

      // Target modern browsers only. All Chromium-based browsers and Firefox
      // support ES2020+ natively, so we don't need heavy transpilation.
      target: "es2020",

      // No source maps in production — keeps the bundle small.
      sourcemap: false,

      // Suppress the "chunk size exceeds 500 kB" warning. Content script
      // bundles with React + components can easily exceed this, and that's
      // fine for an extension (it's loaded locally, not over the network).
      chunkSizeWarningLimit: 1500,
    },

    // -----------------------------------------------------------------------
    // define
    // -----------------------------------------------------------------------
    // Replace process.env.NODE_ENV at build time. Some libraries (notably
    // older React builds) check this to toggle development/production mode.
    // Without this, the bundle would reference `process` which doesn't exist
    // in browser content script context, causing a runtime crash.
    // -----------------------------------------------------------------------
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });
}

// =============================================================================
// Export the correct config based on BUILD_TARGET
// =============================================================================
export default buildTarget === "overlay" ? overlayConfig() : popupConfig();
