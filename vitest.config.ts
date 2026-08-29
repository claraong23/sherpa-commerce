import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@core': r('./packages/core/src'),
      '@agents': r('./packages/agents/src'),
      '@commerce': r('./packages/commerce/src'),
      '@visa': r('./packages/visa/src'),
      '@ui': r('./packages/ui/src'),
    },
  },
})
