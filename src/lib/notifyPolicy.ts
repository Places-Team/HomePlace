/**
 * What reaches a phone, and what only lands in the feed.
 *
 * Every notable thing becomes an event; not every event is worth a buzz at
 * 3am. This is the filter between the two — a floor on severity, plus a
 * per-kind override for the cases the floor gets wrong ("never tell me about
 * logins", "always tell me about a rule, even the quiet ones").
 *
 * Pure, so the settings form imports the same types and the same list of kinds
 * it is choosing between. The default lets everything through, which is exactly
 * how the panel behaved before this existed.
 */

export type Severity = "info" | "warn" | "error";
export type TypeRule = "default" | "always" | "never";

export type NotifyPolicy = {
  /** The floor: an event quieter than this is not sent, unless a type says so. */
  minSeverity: Severity | "off";
  /** Per-kind overrides, keyed by event type. */
  types: Record<string, TypeRule>;
};

export const NOTIFY_POLICY_KEY = "notify.policy";

/** Send everything — the behaviour that predates this setting. */
export const DEFAULT_POLICY: NotifyPolicy = { minSeverity: "info", types: {} };

/**
 * The kinds that flow through notifications, in the order the settings form
 * lists them. Reminders are deliberately absent: they belong to whoever set
 * them and are never gated by a household-wide policy.
 */
export const NOTIFY_EVENT_TYPES = ["down", "up", "restart", "rule", "command", "system", "login", "telegram-bot"] as const;
export type NotifyEventType = (typeof NOTIFY_EVENT_TYPES)[number];

const RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2 };

export function normalizePolicy(value: unknown): NotifyPolicy {
  const v = (value ?? {}) as Partial<NotifyPolicy>;
  const min = v.minSeverity;
  return {
    minSeverity: min === "off" || min === "warn" || min === "error" ? min : "info",
    types: v.types && typeof v.types === "object" ? (v.types as Record<string, TypeRule>) : {},
  };
}

/**
 * Should an event of this type and severity be sent?
 *
 * A type override wins outright; otherwise the severity floor decides. An event
 * whose type nobody has an opinion about (a reminder, say) is always sent —
 * the policy only ever narrows the kinds it explicitly lists.
 */
export function shouldNotify(type: string, severity: Severity, policy: NotifyPolicy): boolean {
  const rule = policy.types[type] ?? "default";
  if (rule === "always") return true;
  if (rule === "never") return false;
  if (policy.minSeverity === "off") return false;
  return RANK[severity] >= RANK[policy.minSeverity];
}
