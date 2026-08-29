/**
 * Deterministic spec → capability tiers.
 *
 * These are lookup tables, not model output. Every number the customer agent
 * shows a user traces back to a value here plus arithmetic in `score.ts`.
 * Demo catalogue values; not a claim about real-world benchmark results.
 */

interface GpuTier {
  match: RegExp
  /** 0..1 raster/3D capability used for gaming + CAD viewport work. */
  raster: number
  /** 0..1 capability for GPU-accelerated CAD / viewport / CUDA workloads. */
  compute: number
  dedicated: boolean
  cuda: boolean
}

const GPU_TIERS: GpuTier[] = [
  { match: /rtx\s*50[89]0/i, raster: 1.0, compute: 1.0, dedicated: true, cuda: true },
  { match: /rtx\s*5070/i, raster: 0.92, compute: 0.92, dedicated: true, cuda: true },
  { match: /rtx\s*5060/i, raster: 0.82, compute: 0.82, dedicated: true, cuda: true },
  { match: /rtx\s*5050/i, raster: 0.7, compute: 0.7, dedicated: true, cuda: true },
  { match: /rtx\s*40[89]0/i, raster: 0.95, compute: 0.95, dedicated: true, cuda: true },
  { match: /rtx\s*4070/i, raster: 0.85, compute: 0.85, dedicated: true, cuda: true },
  { match: /rtx\s*4060/i, raster: 0.74, compute: 0.75, dedicated: true, cuda: true },
  { match: /rtx\s*4050/i, raster: 0.62, compute: 0.64, dedicated: true, cuda: true },
  { match: /rtx\s*3050/i, raster: 0.48, compute: 0.5, dedicated: true, cuda: true },
  { match: /rtx\s*a(1000|2000)/i, raster: 0.55, compute: 0.7, dedicated: true, cuda: true },
  { match: /gtx\s*16/i, raster: 0.38, compute: 0.34, dedicated: true, cuda: true },
  { match: /radeon\s*rx\s*7[6-9]/i, raster: 0.8, compute: 0.6, dedicated: true, cuda: false },
  { match: /radeon\s*rx\s*7[0-5]/i, raster: 0.62, compute: 0.45, dedicated: true, cuda: false },
  { match: /arc\s*a5|arc\s*b5/i, raster: 0.45, compute: 0.35, dedicated: true, cuda: false },
  { match: /radeon\s*(780m|760m|890m)/i, raster: 0.3, compute: 0.22, dedicated: false, cuda: false },
  { match: /iris\s*xe|arc\s*graphics|uhd|integrated/i, raster: 0.18, compute: 0.14, dedicated: false, cuda: false },
]

export function gpuTier(gpu: string): { raster: number; compute: number; dedicated: boolean; cuda: boolean } {
  for (const t of GPU_TIERS) {
    if (t.match.test(gpu)) return { raster: t.raster, compute: t.compute, dedicated: t.dedicated, cuda: t.cuda }
  }
  return { raster: 0.2, compute: 0.16, dedicated: false, cuda: false }
}

interface CpuTier {
  match: RegExp
  /** 0..1 sustained multi-core capability (CAD solve / compile). */
  multi: number
  /** 0..1 single-thread responsiveness (CAD modelling is often ST-bound). */
  single: number
}

const CPU_TIERS: CpuTier[] = [
  { match: /(ultra\s*9|i9|ryzen\s*9)/i, multi: 1.0, single: 0.95 },
  { match: /(ultra\s*7|i7|ryzen\s*7)/i, multi: 0.82, single: 0.85 },
  { match: /(ultra\s*5|i5|ryzen\s*5)/i, multi: 0.62, single: 0.72 },
  { match: /(i3|ryzen\s*3|celeron|athlon)/i, multi: 0.34, single: 0.48 },
  { match: /snapdragon|apple\s*m/i, multi: 0.7, single: 0.82 },
]

export function cpuTier(cpu: string): { multi: number; single: number } {
  for (const t of CPU_TIERS) if (t.match.test(cpu)) return { multi: t.multi, single: t.single }
  return { multi: 0.5, single: 0.55 }
}

/** Newer silicon generation carries a small longevity premium. */
export function generationScore(generation: number | undefined, currentYear = 2026): number {
  if (!generation) return 0.5
  const age = Math.max(0, currentYear - generation)
  return clamp01(1 - age * 0.22)
}

export function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Lighter is better; 1.0kg → 1.0, 3.0kg → 0.0. */
export function portabilityScore(weightKg: number | undefined): number {
  if (weightKg === undefined) return 0.5
  return clamp01((2.9 - weightKg) / 1.9)
}

/** 40Wh → 0.0, 100Wh → 1.0. */
export function batteryScore(batteryWh: number | undefined): number {
  if (batteryWh === undefined) return 0.4
  return clamp01((batteryWh - 40) / 60)
}

export function ramScore(ramGb: number): number {
  return clamp01((ramGb - 8) / 24)
}

export function storageScore(storageGb: number): number {
  return clamp01((storageGb - 256) / 1280)
}
