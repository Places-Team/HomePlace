/** True when an operation has never run or its minimum interval elapsed. */
export function isDue(lastRun: number, intervalMs: number, now = Date.now()): boolean {
  return lastRun <= 0 || now - lastRun >= intervalMs;
}
