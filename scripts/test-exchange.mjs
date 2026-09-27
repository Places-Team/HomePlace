import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const project = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "homeplace-exchange-test-"));
const database = join(temporary, "homeplace-exchange-test.db");
const environment = {
  ...process.env,
  DATABASE_URL: `file:${database}`,
  DATA_DIR: temporary,
  AUTH_SECRET: "homeplace-disposable-exchange-test-key-2026",
  NODE_PATH: [join(project, "node_modules/next/dist/compiled"), process.env.NODE_PATH].filter(Boolean).join(delimiter),
};

function run(command, args) {
  const result = spawnSync(command, args, { cwd: project, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

try {
  // Prisma's SQLite schema engine expects the absolute-path file to exist.
  await writeFile(database, "", { flag: "wx", mode: 0o600 });
  run(join(project, "node_modules/.bin", process.platform === "win32" ? "prisma.cmd" : "prisma"), ["db", "push", "--skip-generate"]);
  run(process.execPath, ["--conditions=react-server", "--import", "tsx", "--test", "tests/exchangeStore.integration.ts"]);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
