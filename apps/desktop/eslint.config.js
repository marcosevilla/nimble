import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // ── DataProvider seam ──
  //
  // UI components must go through the DataProvider abstraction
  // (`useDataProvider()` / `getDataProvider()` from
  // `@/services/provider-context`) so the same components can run on desktop
  // (Tauri) and on the web client. Reaching for `@tauri-apps/*` or the
  // `@/services/tauri` invoke wrappers from a component hard-wires it to the
  // desktop shell. If something genuinely has no web equivalent, keep it out
  // of `src/components/**` — or add a narrow, commented eslint-disable.
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*', '@tauri-apps/**'],
              message:
                'Components must not import Tauri APIs directly — use the DataProvider (useDataProvider()/getDataProvider() from @/services/provider-context) so the component also works on the web client.',
            },
            {
              group: ['@/services/tauri', '**/services/tauri'],
              message:
                'Components must not import invoke wrappers from @/services/tauri — use the DataProvider (useDataProvider()/getDataProvider() from @/services/provider-context). Types belong in @nimble/types.',
            },
          ],
        },
      ],
    },
  },
])
