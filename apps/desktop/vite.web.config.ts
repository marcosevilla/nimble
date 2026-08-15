import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'path'

/**
 * Web build target.
 *
 * Same `src/` as the Tauri build (vite.config.ts), with two differences:
 *
 *  1. `@tauri-apps/api/event` and `@tauri-apps/api/window` are aliased to
 *     no-op stubs in `src/platform/`. This is what lets the 6 components that
 *     import them stay completely untouched — the alias swaps the module out
 *     at resolve time, so no call site needs a `if (isTauri)` branch.
 *  2. The entry HTML is `index.web.html`, which boots `src/main.web.tsx`
 *     (the web entry point that constructs the remote DataProvider).
 *
 * Output goes to `dist-web/` so it never clobbers the Tauri `dist/`.
 */

/**
 * Vite's HTML entry is derived from the input filename, so building
 * `index.web.html` would emit `dist-web/index.web.html` — not something a
 * static host serves at `/`. This plugin renames the emitted asset to
 * `index.html`, and in dev rewrites `/` to the web entry.
 */
function webEntry(): Plugin {
  let outDir = ''
  return {
    name: 'nimble-web-entry',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? ''
        const [pathname, query] = url.split('?')
        if (pathname === '/' || pathname === '/index.html') {
          req.url = '/index.web.html' + (query ? `?${query}` : '')
        }
        next()
      })
    },
    // Vite 8 / rolldown emits the HTML outside `generateBundle`, so the
    // rename happens on disk once the write is finished.
    closeBundle() {
      if (!outDir) return
      const from = path.join(outDir, 'index.web.html')
      const to = path.join(outDir, 'index.html')
      if (fs.existsSync(from)) fs.renameSync(from, to)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), webEntry()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Tauri runtime APIs -> browser no-op stubs
      '@tauri-apps/api/event': path.resolve(__dirname, './src/platform/tauri-event-stub.ts'),
      '@tauri-apps/api/window': path.resolve(__dirname, './src/platform/tauri-window-stub.ts'),
    },
  },
  build: {
    outDir: 'dist-web',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.web.html'),
    },
  },
  server: {
    port: 5174,
    strictPort: false,
  },
})
