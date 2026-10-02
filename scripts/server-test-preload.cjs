// Next removes this marker in server bundles. Plain Node integration tests
// already run on the server and do not need its client-import guard.
const { addHookAliases } = require("next/dist/server/require-hook");
addHookAliases([
  ["server-only", require.resolve("next/dist/compiled/server-only/empty")],
]);
