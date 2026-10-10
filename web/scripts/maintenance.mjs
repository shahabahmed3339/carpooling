import { spawnSync } from "node:child_process";

/**
 * Run every periodic cleanup in one invocation, so an environment schedules a
 * single job rather than three and cannot accidentally leave one out.
 *
 * The app schedules nothing itself — there is no cron in a Next.js process — so
 * each deployment chooses how to run this. Running all three together is the
 * point: `db:prune-notifications` and `db:prune-idempotency` were already
 * documented as "needs scheduling", and a command that runs one but not the
 * others is how a table quietly stops being bounded.
 *
 * Each step is bounded and self-reporting. Failure of one does not stop the
 * others (a notification prune failing should not prevent idempotency cleanup),
 * but the process exits non-zero if any step failed, so a scheduler can alert.
 *
 * Usage:
 *   npm run db:maintenance                 # prune with deployed defaults
 *   npm run db:maintenance -- --dry-run    # preview every step, delete nothing
 */

const dryRun = process.argv.includes("--dry-run");

const steps = [
  { name: "notifications", script: "./scripts/prune-notifications.mjs" },
  { name: "idempotency", script: "./scripts/prune-idempotency.mjs" },
  { name: "history", script: "./scripts/prune-history.mjs" },
];

const failures = [];
for (const step of steps) {
  process.stdout.write(`\n=== ${step.name}${dryRun ? " (dry run)" : ""} ===\n`);
  const result = spawnSync(
    process.execPath,
    [step.script, ...(dryRun ? ["--dry-run"] : [])],
    { cwd: process.cwd(), stdio: "inherit" },
  );
  if (result.status !== 0) failures.push(step.name);
}

process.stdout.write(
  failures.length === 0
    ? "\nAll maintenance steps completed.\n"
    : `\nMaintenance finished with failures: ${failures.join(", ")}. See output above.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
