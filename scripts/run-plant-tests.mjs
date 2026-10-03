import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const root = await mkdtemp(
  `${process.platform === "darwin" ? "/private/tmp" : "/tmp"}/homeplace-plants-`,
);
const env = {
  ...process.env,
  DATABASE_URL: `file:${root}/test.db`,
  DATA_DIR: root,
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_CHAT_ID: "",
  TELEGRAM_PROXY_URL: "",
  AUTH_SECRET: "homeplace-local-plant-test-secret-00000000",
};
try {
  // Initialize an actual SQLite header before the schema engine opens the file.
  const db = new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });
  try {
    await db.$executeRawUnsafe("PRAGMA user_version=1");
  } finally {
    await db.$disconnect();
  }
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { env, stdio: "inherit" },
  );
  execFileSync(
    process.execPath,
    [
      "--require",
      "./scripts/server-test-preload.cjs",
      "--import",
      "tsx",
      process.argv[2] === "batches" ? "scripts/test-batches.ts" : "scripts/test-plants.ts",
    ],
    { env, stdio: "inherit" },
  );
} finally {
  if (process.env.KEEP_PLANT_TEST_DATA === "1")
    console.log(`Temporary plant-test data: ${root}`);
  else await rm(root, { recursive: true, force: true });
}
