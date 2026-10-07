"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { deviceGraph, PLATFORM_NAMES, type DeviceView, type GraphNode } from "@/lib/deviceWorkspace";
import { AccountIcon, DeviceLogo, ZoomIcon } from "./DeviceIdentity";
import styles from "./DevicesWorkspace.module.css";

type Point = { x: number; y: number };
type Viewport = Point & { scale: number };
type Drag = { pointerId: number; x: number; y: number; start: Point; nodeId?: string; moved: boolean };

export function DeviceGraph({ devices, selected, onSelect, serverUrl, ru }: {
  devices: DeviceView[]; selected: string; onSelect: (id: string) => void; serverUrl: string; ru: boolean;
}) {
  const graph = useMemo(() => deviceGraph(devices), [devices]);
  const deviceMap = useMemo(() => new Map(devices.map(device => [device.id, device])), [devices]);
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 800, height: 500 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const say = (en: string, russian: string) => ru ? russian : en;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(current => current.width === width && current.height === height ? current : { width, height });
    });
    observer.observe(element);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);

  const fitScale = Math.max(.25, Math.min(1, (size.width - 40) / graph.width, (size.height - 40) / graph.height));
  useEffect(() => {
    setView({ x: (size.width - graph.width * fitScale) / 2, y: (size.height - graph.height * fitScale) / 2, scale: fitScale });
  }, [size.width, size.height, graph.width, graph.height, fitScale]);

  function fit() {
    setPositions({});
    setView({ x: (size.width - graph.width * fitScale) / 2, y: (size.height - graph.height * fitScale) / 2, scale: fitScale });
  }
  function zoom(factor: number) {
    setView(current => {
      const scale = Math.max(.25, Math.min(2, current.scale * factor));
      const ratio = scale / current.scale;
      return { scale, x: size.width / 2 - (size.width / 2 - current.x) * ratio, y: size.height / 2 - (size.height / 2 - current.y) * ratio };
    });
  }
  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-node-id]");
    const nodeId = element?.dataset.nodeId;
    const node = nodeId ? graph.nodes.find(node => node.id === nodeId) : null;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      start: node ? positions[node.id] ?? { x: node.x, y: node.y } : { x: view.x, y: view.y }, nodeId, moved: false };
    if (!nodeId) event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (Math.abs(dx) + Math.abs(dy) < 5 && !current.moved) return;
    current.moved = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (current.nodeId) setPositions(previous => ({ ...previous, [current.nodeId!]: { x: current.start.x + dx / view.scale, y: current.start.y + dy / view.scale } }));
      else setView(previous => ({ ...previous, x: current.start.x + dx, y: current.start.y + dy }));
    });
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.current.moved) event.preventDefault();
    // Keep the movement flag through the following click to avoid selecting a dragged node.
    drag.current.pointerId = -1;
  }
  function choose(id: string, keyboard: boolean) {
    if (!keyboard && drag.current?.moved) { drag.current = null; return; }
    onSelect(id);
  }
  function point(node: GraphNode) { return positions[node.id] ?? node; }
  const nodeMap = new Map(graph.nodes.map(node => [node.id, node]));
  const serverHost = new URL(serverUrl).host;

  return <section aria-label={say("Device connection map", "Карта связей устройств")} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-ok" />{say("Online", "В сети")}</span>
        <span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full border border-muted" />{say("Offline", "Нет связи")}</span>
        <span className="hidden sm:inline">{say("Select a node · drag to rearrange", "Выберите узел · потяните, чтобы переместить")}</span>
      </div>
      <div className="flex items-center gap-1 rounded-control border border-line bg-surface p-1">
        <button type="button" aria-label={say("Zoom out", "Уменьшить масштаб")} className="rounded-md p-2 hover:bg-raised" onClick={() => zoom(1 / 1.2)}><ZoomIcon minus /></button>
        <output className="w-12 text-center text-xs tabular-nums text-muted" aria-label={say("Scale", "Масштаб")}>{Math.round(view.scale * 100)}%</output>
        <button type="button" aria-label={say("Zoom in", "Увеличить масштаб")} className="rounded-md p-2 hover:bg-raised" onClick={() => zoom(1.2)}><ZoomIcon /></button>
        <button type="button" className="rounded-md px-2 py-1.5 text-xs font-medium hover:bg-raised" onClick={fit}>{say("Fit", "Вписать")}</button>
      </div>
    </div>
    <div ref={canvas} className={styles.canvas} tabIndex={0} aria-label={say("Map canvas. Arrow keys move, plus and minus zoom, zero resets.", "Поле карты. Стрелки перемещают, плюс и минус меняют масштаб, ноль сбрасывает.")}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const moves: Record<string, Point> = { ArrowLeft: { x: 40, y: 0 }, ArrowRight: { x: -40, y: 0 }, ArrowUp: { x: 0, y: 40 }, ArrowDown: { x: 0, y: -40 } };
        if (moves[event.key]) { event.preventDefault(); const delta = moves[event.key]; setView(previous => ({ ...previous, x: previous.x + delta.x, y: previous.y + delta.y })); }
        else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.2); }
        else if (event.key === "-") { event.preventDefault(); zoom(1 / 1.2); }
        else if (event.key === "0") { event.preventDefault(); fit(); }
      }} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className={styles.scene} style={{ width: graph.width, height: graph.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={graph.width} height={graph.height} aria-hidden>
          {graph.edges.map(edge => {
            const from = nodeMap.get(edge.from)!, to = nodeMap.get(edge.to)!;
            const a = point(from), b = point(to);
            const x1 = a.x + from.width / 2, y1 = a.y + from.height, x2 = b.x + to.width / 2, y2 = b.y;
            const offline = to.deviceId && !deviceMap.get(to.deviceId)?.online;
            return <path key={`${edge.from}-${edge.to}`} d={`M${x1} ${y1} C${x1} ${(y1 + y2) / 2},${x2} ${(y1 + y2) / 2},${x2} ${y2}`}
              className={`${styles.edge} ${selected === edge.from || selected === edge.to ? styles.activeEdge : ""} ${offline ? styles.inactiveEdge : ""}`} />;
          })}
        </svg>
        {graph.nodes.map(node => {
          const pos = point(node);
          const device = node.deviceId ? deviceMap.get(node.deviceId) : null;
          const owned = node.kind === "account" ? devices.filter(device => device.ownerId === node.ownerId) : [];
          const name = node.kind === "server" ? "HomePlace" : device?.name ?? owned[0]?.ownerName ?? say("Unassigned", "Без владельца");
          return <button key={node.id} type="button" data-node-id={node.id}
            aria-label={device ? `${device.name}, ${PLATFORM_NAMES[device.platform] ?? device.platform}, ${device.online ? say("online", "в сети") : say("offline", "нет связи")}` : name}
            aria-pressed={selected === node.id} onClick={event => choose(node.id, event.detail === 0)}
            className={`${styles.node} ${selected === node.id ? styles.selected : ""} ${node.kind === "server" ? styles.server : ""}`}
            style={{ width: node.width, height: node.height, transform: `translate(${pos.x}px, ${pos.y}px)` }}>
            {device ? <DeviceLogo platform={device.platform} /> : node.kind === "server"
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src="/icon-192.png" alt="" draggable={false} className="h-11 w-11 rounded-xl" />
              : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-muted"><AccountIcon /></span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-semibold" title={name}>{name}</span>
              <span className="mt-1 block truncate text-xs text-muted">{device ? `${PLATFORM_NAMES[device.platform] ?? device.platform} ${device.platformVersion}` : node.kind === "server" ? serverHost : say(`${owned.length} device(s)`, `Устройств: ${owned.length}`)}</span>
              {device && <span className={`mt-2 flex items-center gap-1.5 text-xs ${device.online ? "text-ok" : "text-muted"}`}><span className={`h-1.5 w-1.5 rounded-full ${device.online ? "bg-ok" : "bg-muted/50"}`} />{device.online ? say("Online", "В сети") : say("Offline", "Нет связи")}</span>}
              {node.kind === "server" && <span className="mt-2 block text-xs text-accent">{say("Your server", "Ваш сервер")}</span>}
            </span>
          </button>;
        })}
      </div>
    </div>
    <p className="text-xs leading-relaxed text-muted">{say("Lines show account bindings, not network routes. Availability comes from each device's latest heartbeat.", "Линии показывают привязку к аккаунтам, а не маршруты сети. Статус определяется последним ответом устройства.")}</p>
  </section>;
}
