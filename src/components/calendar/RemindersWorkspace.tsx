"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addReminder, completeReminder, deleteReminder, restoreReminder, updateReminder } from "@/actions/reminders";
import { makeRepeat, repeatLabel, type RepeatUnit } from "@/lib/recurrence";
import { Button, Input, Select } from "@/components/form";
import type { Dictionary } from "@/i18n";

export type PlanReminder = {
  id: string;
  title: string;
  at: string;
  repeat: string;
  completedAt: string | null;
};

function localInput(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function nextHour(): string {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return localInput(date);
}

export function RemindersWorkspace({ active, completed, d, locale }: {
  active: PlanReminder[];
  completed: PlanReminder[];
  d: Dictionary;
  locale: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState(nextHour);
  const [repeatMode, setRepeatMode] = useState("none");
  const [everyN, setEveryN] = useState("2");
  const [everyUnit, setEveryUnit] = useState<RepeatUnit>("day");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function open(row?: PlanReminder) {
    setEditing(row?.id ?? "new");
    setTitle(row?.title ?? "");
    setAt(row ? localInput(new Date(row.at)) : nextHour());
    const match = row?.repeat.match(/^every:(\d+):(hour|day|week|month|year)$/);
    setRepeatMode(match ? "custom" : row?.repeat ?? "none");
    setEveryN(match?.[1] ?? "2");
    setEveryUnit((match?.[2] as RepeatUnit) ?? "day");
    setError("");
  }

  function run(action: () => Promise<void>) {
    setError("");
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch {
        setError(d.plan.saveFailed);
      }
    });
  }

  function save() {
    if (!editing || !title.trim() || !at) return;
    const repeat = repeatMode === "custom" ? makeRepeat(Number(everyN) || 2, everyUnit) : repeatMode;
    const input = { title: title.trim(), at, repeat };
    const id = editing;
    run(async () => {
      if (id === "new") await addReminder(input);
      else await updateReminder(id, input);
      setEditing(null);
    });
  }

  const overdue = active.filter((row) => new Date(row.at).getTime() < Date.now());
  const upcoming = active.filter((row) => new Date(row.at).getTime() >= Date.now());

  return (
    <div className="space-y-7" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{d.plan.upcoming}: {active.length}</p>
        <Button variant="primary" onClick={() => open()}>{d.plan.addReminder}</Button>
      </div>

      {editing && (
        <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-4 rounded-card border border-accent/40 bg-surface p-4 sm:p-5">
          <h2 className="text-lg font-semibold">{editing === "new" ? d.plan.addReminder : d.plan.editReminder}</h2>
          <label className="block space-y-1 text-sm font-medium">
            <span>{d.reminders.what}</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} autoFocus required />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm font-medium">
              <span>{d.calendarPage.title}</span>
              <Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} required />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>{d.reminders.repeatLabel}</span>
              <Select value={repeatMode} onChange={(event) => setRepeatMode(event.target.value)}>
                <option value="none">{d.reminders.once}</option>
                <option value="daily">{d.reminders.daily}</option>
                <option value="weekly">{d.reminders.weekly}</option>
                <option value="monthly">{d.reminders.monthly}</option>
                <option value="yearly">{d.reminders.yearly}</option>
                <option value="custom">{d.reminders.custom}</option>
              </Select>
            </label>
          </div>
          {repeatMode === "custom" && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted">{d.reminders.custom}</span>
              <Input className="w-20" type="number" min={2} max={365} value={everyN} onChange={(event) => setEveryN(event.target.value)} aria-label={d.reminders.count} />
              <Select className="max-w-40" value={everyUnit} onChange={(event) => setEveryUnit(event.target.value as RepeatUnit)} aria-label={d.reminders.repeatLabel}>
                <option value="hour">{d.reminders.unitHours}</option>
                <option value="day">{d.reminders.unitDays}</option>
                <option value="week">{d.reminders.unitWeeks}</option>
                <option value="month">{d.reminders.unitMonths}</option>
                <option value="year">{d.reminders.unitYears}</option>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>{d.common.cancel}</Button>
            <Button type="submit" variant="primary" disabled={pending || !title.trim()}>{d.common.save}</Button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="rounded-control bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      {active.length === 0 && <div className="rounded-card border border-dashed border-line px-5 py-10 text-center text-sm text-muted">{d.reminders.empty}</div>}
      {overdue.length > 0 && <ReminderGroup title={d.plan.overdue} rows={overdue} d={d} locale={locale} pending={pending} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} edit={open} run={run} />}
      {upcoming.length > 0 && <ReminderGroup title={d.plan.upcoming} rows={upcoming} d={d} locale={locale} pending={pending} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} edit={open} run={run} />}

      <details className="border-t border-line pt-5">
        <summary className="cursor-pointer py-2 text-base font-semibold">{d.plan.completed} <span className="ml-1 font-normal text-muted">{completed.length}</span></summary>
        {completed.length === 0 ? <p className="py-5 text-sm text-muted">{d.plan.emptyCompleted}</p> : (
          <ul className="divide-y divide-line">
            {completed.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-3">
                <span aria-hidden className="text-ok">✓</span>
                <span className="min-w-0 flex-1 break-words text-sm text-muted">{row.title}</span>
                <Button size="sm" onClick={() => run(() => restoreReminder(row.id))} disabled={pending}>{d.plan.restore}</Button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}

function ReminderGroup({ title, rows, d, locale, pending, confirmDelete, setConfirmDelete, edit, run }: {
  title: string;
  rows: PlanReminder[];
  d: Dictionary;
  locale: string;
  pending: boolean;
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  edit: (row: PlanReminder) => void;
  run: (action: () => Promise<void>) => void;
}) {
  return <section>
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">{title}</h2>
    <ul className="divide-y divide-line border-t border-line">
      {rows.map((row) => (
        <li key={row.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 py-4 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center">
          <button type="button" onClick={() => run(() => completeReminder(row.id))} disabled={pending} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-muted hover:border-ok hover:bg-ok/10 hover:text-ok" aria-label={`${row.title} — ${d.reminders.done}`}>✓</button>
          <div className="min-w-0 flex-1">
            <p className="break-words text-base font-medium">{row.title}</p>
            <p className="mt-1 text-sm text-muted">{new Date(row.at).toLocaleString(locale, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}{row.repeat !== "none" && ` · ${repeatLabel(row.repeat, d)}`}</p>
          </div>
          <div className="col-start-2 flex flex-wrap gap-1 sm:col-start-3 sm:flex-nowrap">
            <Button size="sm" variant="quiet" onClick={() => edit(row)} disabled={pending}>{d.common.edit}</Button>
            {confirmDelete === row.id ? <Button size="sm" variant="danger" onClick={() => { setConfirmDelete(null); run(() => deleteReminder(row.id)); }} disabled={pending}>{d.common.delete}?</Button> : <Button size="sm" variant="quiet" onClick={() => setConfirmDelete(row.id)} disabled={pending}>{d.common.delete}</Button>}
          </div>
        </li>
      ))}
    </ul>
  </section>;
}
