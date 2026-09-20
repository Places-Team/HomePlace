"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, Badge } from "@/components/ui";
import { Field, Select, Button } from "@/components/form";
import { saveNotifyPolicy } from "@/actions/services";
import { NOTIFY_EVENT_TYPES, type NotifyPolicy, type TypeRule } from "@/lib/notifyPolicy";
import type { Dictionary } from "@/i18n";

/**
 * Which events also become notifications.
 *
 * Two controls, in the order most people think: a floor on severity that
 * handles the common wish ("only warn me about real problems"), and a per-kind
 * override for the exceptions the floor gets wrong. The feed keeps everything
 * regardless — this only decides what buzzes a phone.
 */
export function NotifyPolicyForm({ d, policy: initial }: { d: Dictionary; policy: NotifyPolicy }) {
  const [minSeverity, setMinSeverity] = useState(initial.minSeverity);
  const [types, setTypes] = useState<Record<string, TypeRule>>(initial.types);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const kindLabel: Record<string, string> = {
    down: d.settings.kindDown,
    up: d.settings.kindUp,
    restart: d.settings.kindRestart,
    rule: d.settings.kindRule,
    command: d.settings.kindCommand,
    system: d.settings.kindSystem,
    login: d.settings.kindLogin,
    "telegram-bot": d.settings.kindTelegramBot,
  };

  function setKind(type: string, rule: TypeRule) {
    setSaved(false);
    setTypes((prev) => {
      const next = { ...prev };
      if (rule === "default") delete next[type];
      else next[type] = rule;
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      await saveNotifyPolicy({ minSeverity, types });
      setSaved(true);
    });
  }

  return (
    <Card>
      <CardHeader title={d.settings.notifyPolicy} action={saved ? <Badge tone="ok">{d.common.save}</Badge> : null} />
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted">{d.settings.notifyPolicyHint}</p>

        <Field label={d.settings.minSeverity}>
          <Select
            value={minSeverity}
            onChange={(e) => {
              setSaved(false);
              setMinSeverity(e.target.value as NotifyPolicy["minSeverity"]);
            }}
          >
            <option value="info">{d.settings.sevInfo}</option>
            <option value="warn">{d.settings.sevWarn}</option>
            <option value="error">{d.settings.sevError}</option>
            <option value="off">{d.settings.sevOff}</option>
          </Select>
        </Field>

        <div>
          <p className="mb-2 text-xs font-medium text-muted">{d.settings.perKind}</p>
          <div className="divide-y divide-line rounded-control border border-line">
            {NOTIFY_EVENT_TYPES.map((type) => (
              <div key={type} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm">{kindLabel[type] ?? type}</span>
                <Select
                  value={types[type] ?? "default"}
                  onChange={(e) => setKind(type, e.target.value as TypeRule)}
                  className="w-36"
                >
                  <option value="default">{d.settings.ruleDefault}</option>
                  <option value="always">{d.settings.ruleAlways}</option>
                  <option value="never">{d.settings.ruleNever}</option>
                </Select>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="primary" disabled={pending} onClick={save}>
            {d.common.save}
          </Button>
        </div>
      </div>
    </Card>
  );
}
