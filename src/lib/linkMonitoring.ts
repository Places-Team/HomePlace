export type MobileContainerSource = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health?: string;
  hostKey: string;
  hostLabel: string;
};

export function mobileContainerSummary(containers: MobileContainerSource[]) {
  const items = containers.slice(0, 100).map((container) => ({
    id: `${container.hostKey}:${container.id}`,
    name: container.name,
    image: container.image,
    state: container.state,
    status: container.status,
    health: container.health ?? null,
    hostKey: container.hostKey,
    hostLabel: container.hostLabel,
  }));
  return {
    total: items.length,
    running: items.filter((item) => item.state === "running").length,
    stopped: items.filter((item) => item.state !== "running").length,
    problems: items.filter(
      (item) => item.state === "restarting" || item.state === "dead" || item.health === "unhealthy"
    ).length,
    items,
  };
}
