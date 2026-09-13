"use client";

import { useState } from "react";
import { Button } from "@/components/form";
import { ItemDialog, type ContainerOption } from "./ItemDialog";
import type { Dictionary } from "@/i18n";

/** The + that opens the add dialog. Everything on a dashboard starts here. */
export function AddButton({
  d,
  dashboardId,
  containers,
  folders,
  iconPack = false,
}: {
  d: Dictionary;
  dashboardId: string;
  containers: ContainerOption[];
  folders: { id: string; title: string }[];
  iconPack?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)} title={d.dashboard.addTitle}>
        + {d.common.add}
      </Button>
      {open && (
        <ItemDialog
          d={d}
          mode="add"
          dashboardId={dashboardId}
          containers={containers}
          folders={folders}
          iconPack={iconPack}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
