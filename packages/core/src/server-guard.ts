/**
 * Runtime boundary marker for modules that read secrets or talk to
 * privileged services. Importing one of these from a client component would
 * pull the module into the browser bundle; this makes that failure loud
 * instead of silent.
 *
 * Deliberately not the `server-only` package: these modules are also imported
 * by plain Node scripts (seed, smoke test), which `server-only` rejects.
 */
export function assertServer(moduleName: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      `[security] ${moduleName} is server-only and must never be imported into a client bundle.`,
    )
  }
}
