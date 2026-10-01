import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

// Maps the build-time-only '@/*' alias onto the real src directory so that
// plain Node (nodemon, `node src/index.mjs`, tests) can execute the sources.
// esbuild inlines the same alias during `pnpm build` via esbuild.config.mjs.
const SRC_ROOT = pathToFileURL(
    path.resolve(fileURLToPath(import.meta.url), '../../src') + path.sep
).href;

export function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
        return nextResolve(SRC_ROOT + specifier.slice(2), context);
    }
    return nextResolve(specifier, context);
}
