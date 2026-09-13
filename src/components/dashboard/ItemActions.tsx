"use client";

import { useState, useTransition } from "react";
import type { Item } from "@prisma/client";
import { deleteItem, toggleLock } from "@/actions/dashboard";
import { ItemDialog } from "./ItemDialog";
import { useEditMode } from "./EditMode";
import type { Dictionary } from "@/i18n";

/**
 * Edit, pin and delete, on a tile in edit mode.
 *
 * The toolbar used to sit on the tile permanently and cover the very corner you
 * were trying to see the widget's live preview in. Now it is hidden until the
 * tile is hovered (or focused), so the board reads clean while you arrange it
 * and the controls appear only when you reach for them. Touch devices, which
 * have no hover, keep it visible — there is nowhere else for it to come from.
 *
 * `pointer-events-auto` matters: in edit mode the whole tile is covered by a
 * drag surface and its contents are made inert, so these buttons have to opt
 * back in — otherwise the pencil is there but nothing happens when it is
 * clicked.
 */
export function ItemActions({ item, d, iconPack = false }: { item: Item; d: Dictionary; iconPack?: boolean }) {
  const { editing: modeEditing } = useEditMode();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  // Rendered on every tile but only present while the board is being edited —
  // which is what lets edit mode be an instant client toggle rather than a
  // navigation that re-renders the whole page.
  if (!modeEditing) return null;

  return (
    <>
      <div className="pointer-events-auto absolute right-1.5 top-1.5 z-20 flex gap-0.5 rounded-control border border-line bg-surface/95 p-0.5 opacity-0 shadow-card transition-opacity duration-150 focus-within:opacity-100 group-hover/cell:opacity-100 [@media(hover:none)]:opacity-100">
        <IconButton
          label={item.locked ? d.dashboard.unpin : d.dashboard.pin}
          active={item.locked}
          disabled={pending}
          onClick={() => startTransition(() => void toggleLock(item.id))}
        >
          {item.locked ? "🔒" : "🔓"}
        </IconButton>
        <IconButton label={d.common.edit} disabled={pending} onClick={() => setEditing(true)}>
          ✎
        </IconButton>
        <IconButton
          label={d.common.delete}
          danger
          disabled={pending}
          onClick={() => {
            // A tile can hold a carefully typed address; deleting it by a
            // mis-aimed tap on a phone should not be silent.
            if (!confirm(d.common.confirmDelete)) return;
            startTransition(() => void deleteItem(item.id));
          }}
        >
          ✕
        </IconButton>
      </div>

      {editing && <ItemDialog d={d} mode="edit" item={item} iconPack={iconPack} onClose={() => setEditing(false)} />}
    </>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
  danger,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      // The drag surface is listening on the tile; without stopping the event
      // here, pressing a button would also start a drag.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`h-7 w-7 rounded text-xs transition-colors disabled:opacity-40 ${
        danger
          ? "text-danger hover:bg-danger/10"
          : active
            ? "bg-warn/15 text-warn"
            : "text-muted hover:bg-raised hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
