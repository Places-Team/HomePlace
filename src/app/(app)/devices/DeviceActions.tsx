"use client";

import { useTransition } from "react";
import {
  approvePairing,
  rejectPairing,
  revokeDevice,
  sendDeviceTestNotification,
} from "@/actions/linkDevices";
import { Button } from "@/components/form";
import type { Dictionary } from "@/i18n";

export function PairingActions({ id, d }: { id: string; d: Dictionary }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      <Button variant="primary" disabled={pending} onClick={() => startTransition(() => approvePairing(id))}>
        {d.devices.approve}
      </Button>
      <Button disabled={pending} onClick={() => startTransition(() => rejectPairing(id))}>
        {d.devices.reject}
      </Button>
    </div>
  );
}

export function DeviceActions({ id, canNotify, d }: { id: string; canNotify: boolean; d: Dictionary }) {
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      {canNotify && (
        <Button disabled={pending} onClick={() => startTransition(() => sendDeviceTestNotification(id))}>
          {d.devices.testNotification}
        </Button>
      )}
      <Button
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (window.confirm(d.devices.revokeConfirm)) startTransition(() => revokeDevice(id));
        }}
      >
        {d.devices.revoke}
      </Button>
    </div>
  );
}
