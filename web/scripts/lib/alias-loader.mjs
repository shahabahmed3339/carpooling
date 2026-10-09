/**
 * A Node module-resolution hook that lets the verify scripts import the real
 * server modules instead of re-implementing their SQL.
 *
 * The scripts under `scripts/` are plain `.mjs`, but the services they must
 * exercise live in `src/` as TypeScript that imports through the `@/*` path
 * alias. Node can strip TypeScript types natively (we run with
 * `--experimental-strip-types`), but it does not know the alias, and a script
 * cannot `import "@/server/..."`.
 *
 * This hook maps `@/x` to `src/x` and appends the extensions Node needs. It is
 * deliberately small: it only rewrites bare specifiers starting with `@/`.
 *
 * Why this exists: the previous `verify-dispute.mjs` carried its own copy of
 * `resolveTripDispute`'s SQL, so it verified the copy, not the code — and the
 * real path was broken (a wrong column name, then a missing confirmation flag,
 * then an unmigrated notification kind) while the test stayed green.
 */

import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");

const candidateExtensions = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];

/** Resolve an `@/…` alias to a real file on disk. */
function resolveAlias(specifier) {
  const relative = specifier.slice(2); // strip "@/"
  const base = path.join(srcRoot, relative);

  if (existsSync(base) && path.extname(base) !== "") return base;

  for (const extension of candidateExtensions) {
    const withExtension = `${base}${extension}`;
    if (existsSync(withExtension)) return withExtension;
  }
  for (const extension of candidateExtensions) {
    const asIndex = path.join(base, `index${extension}`);
    if (existsSync(asIndex)) return asIndex;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = resolveAlias(specifier);
    if (resolved) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    throw new Error(`Could not resolve alias ${specifier} under ${srcRoot}`);
  }
  return nextResolve(specifier, context);
}

/**
 * Node refuses to strip types for files it treats as CommonJS or that use syntax
 * it cannot erase. The server modules are ES modules with type-only imports, so
 * marking `.ts` as `module` is enough. Note that this project's `errors.ts` uses
 * TypeScript parameter properties, which strip-only mode rejects — run the
 * scripts with `--experimental-transform-types`, which handles them.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    return nextLoad(url, { ...context, format: "module-typescript" });
  }
  return nextLoad(url, context);
}
