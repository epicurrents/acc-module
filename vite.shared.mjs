/**
 * Shared pieces of the Vite build and test configs.
 * @package    epicurrents/acc-module
 * @copyright  2026 Sampsa Lohi
 * @license    Apache-2.0
 */
import { fileURLToPath, URL } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const pkg = require('./package.json')

/** Resolve a path relative to the package root. */
export const abs = (p) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Internal `#*` path aliases, mirroring the `paths` in tsconfig.json. The library build and the test
 * suite both resolve through this one table; the package declares no `imports` field, so an alias
 * missing here fails to resolve rather than falling through to another mapping.
 *
 * Regular expressions rather than strings: a string alias matches only the exact id or the id
 * followed by `/`, so `'#'` would never match `#components/AccMontage`.
 */
export const ALIASES = [
    { find: /^#root\//, replacement: abs('./') + '/' },
    {
        find: /^#(components|config|events|loader|runtime|service|types|util)\b/,
        replacement: abs('./src') + '/$1',
    },
]

/**
 * Declared and peer dependencies stay bare imports in `dist/`, so a consumer installs one copy of
 * each rather than inheriting a bundled one. The peers matter more than the dependencies here: the
 * core package holds the runtime singletons this module registers against, and a second bundled
 * copy of it would register against a different one.
 */
export const externalDependencies = (id) => [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
].some(dep => id === dep || id.startsWith(`${dep}/`))
