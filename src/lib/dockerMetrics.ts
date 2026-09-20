export type DockerCpuSample = { cpu: number; system: number };

/** Calculate Docker CPU from two lightweight one-shot counter readings. */
export function dockerCpuPercent(current: DockerCpuSample, previous: DockerCpuSample | undefined, cores: number): number {
  if (!previous) return 0;
  const cpuDelta = current.cpu - previous.cpu;
  const systemDelta = current.system - previous.system;
  return systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * Math.max(1, cores) * 100 : 0;
}
