/**
 * Library build — emits the ESM `dist/` that every consumer imports.
 *
 * Module structure is preserved one-to-one with `src/`, so a consumer's bundler can still
 * tree-shake at module granularity. Type declarations are emitted separately by `build:types`;
 * this build emits JavaScript only.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */
import { defineConfig } from 'vite'
import { ALIASES, abs, externalDependencies } from './vite.shared.mjs'

export default defineConfig({
    build: {
        lib: {
            entry: {
                'index': abs('./src/index.ts'),
            },
            formats: ['es'],
        },
        minify: false,
        outDir: abs('./dist'),
        emptyOutDir: true,
        target: 'esnext',
        rollupOptions: {
            external: externalDependencies,
            output: {
                preserveModules: true,
                preserveModulesRoot: abs('./src'),
                entryFileNames: '[name].js',
            },
        },
    },
    resolve: {
        alias: ALIASES,
    },
})
