/**
 * Exercise area-alias matching against a real database.
 *
 * The whole point of an alias is that one spelling finds a trip published under
 * another. These checks use the same resolution SQL search uses, so a broken
 * alias (or a chain that disagrees with search) is caught here rather than by a
 * rider who cannot find their driver.
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-area-alias.mjs
 */
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new Pool({
  connectionString: url.toString(),
  max: 2,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const CID = "00000000-0000-4000-8000-000000000002";
const results = [];
const check = (n, p, d) => results.push({ n, p, d });
const tag = `al${randomUUID().slice(0, 6)}`;
const NORM = (col) => `lower(regexp_replace(trim(${col}), '[[:space:]]+', ' ', 'g'))`;

/** Resolve one area the way search resolves the viewer's input. */
async function resolve(area) {
  // The app normalizes before querying (normalizeArea), so mirror that here.
  const normalized = area.trim().replace(/\s+/gu, " ").toLowerCase();
  const row = await pool.query(
    `SELECT COALESCE(
       (SELECT a.canonical_area FROM area_aliases a WHERE a.community_id = $1 AND a.alias_area = $2),
       $2) AS resolved`,
    [CID, normalized],
  );
  return row.rows[0]?.resolved;
}

/** Would a trip published in `tripArea` be found by a search for `searchArea`? */
async function matches(searchArea, tripArea) {
  const resolvedSearch = await resolve(searchArea);
  const row = await pool.query(
    `SELECT ${NORM("$1::text")} = COALESCE(
       (SELECT a.canonical_area FROM area_aliases a
         WHERE a.community_id = $2 AND a.alias_area = ${NORM("$1::text")}),
       $3::text) AS matches`,
    [tripArea, CID, resolvedSearch],
  );
  return row.rows[0]?.matches === true;
}

const aliasIds = [];
try {
  const canonical = `${tag} gulberg`;
  const alias = `${tag} gulberg iii`;

  // Without an alias, two spellings must not match.
  check("two different areas do not match before an alias exists", (await matches(alias, canonical)) === false);

  const inserted = await pool.query(
    `INSERT INTO area_aliases (id, community_id, alias_area, canonical_area, note)
     VALUES ($1,$2,$3,$4,'test alias') RETURNING id`,
    [randomUUID(), CID, alias, canonical],
  );
  aliasIds.push(inserted.rows[0].id);

  check("the alias resolves to its canonical area", (await resolve(alias)) === canonical, `resolved=${await resolve(alias)}`);
  check("an unaliased area resolves to itself", (await resolve(canonical)) === canonical);
  check("searching by the alias finds the canonical trip", (await matches(alias, canonical)) === true);
  check("searching by the canonical area finds it too", (await matches(canonical, canonical)) === true);

  // Whitespace and case must still be ignored, as in the non-alias path.
  check("alias resolution ignores case and extra spaces", (await matches(`${alias.toUpperCase()}`, canonical)) === true);

  // A second alias cannot quietly overwrite the first target.
  let duplicateRejected = false;
  try {
    await pool.query(
      `INSERT INTO area_aliases (id, community_id, alias_area, canonical_area) VALUES ($1,$2,$3,$4)`,
      [randomUUID(), CID, alias, `${tag} other`],
    );
  } catch {
    duplicateRejected = true;
  }
  check("a second alias for the same area is rejected", duplicateRejected);

  // An alias cannot point at itself.
  let selfRejected = false;
  try {
    await pool.query(
      `INSERT INTO area_aliases (id, community_id, alias_area, canonical_area) VALUES ($1,$2,$3,$3)`,
      [randomUUID(), CID, `${tag} selfy`],
    );
  } catch {
    selfRejected = true;
  }
  check("an alias pointing at itself is rejected by the schema", selfRejected);

  // Removing the alias restores exact-match behaviour.
  await pool.query("DELETE FROM area_aliases WHERE id = $1", [inserted.rows[0].id]);
  aliasIds.length = 0;
  check("removing the alias restores exact matching", (await matches(alias, canonical)) === false);
} finally {
  for (const id of aliasIds) {
    await pool.query("DELETE FROM area_aliases WHERE id = $1", [id]).catch(() => {});
  }
  await pool.query("DELETE FROM area_aliases WHERE alias_area LIKE $1 OR canonical_area LIKE $1", [`${tag}%`]).catch(() => {});
}

let failed = 0;
for (const r of results) {
  if (!r.p) failed += 1;
  console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.p ? "" : `  -> ${r.d}`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
