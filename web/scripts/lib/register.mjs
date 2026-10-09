/**
 * Registers the `@/*` alias-resolution hook for a plain Node process.
 *
 * Usage (from web/):
 *   node --experimental-strip-types --import ./scripts/lib/register.mjs scripts/verify-*.mjs
 *
 * Keeping this separate from the hook itself means the hook file stays a pure
 * module with no side effects, which is easier to reason about and to test.
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(`${import.meta.dirname}/`));
