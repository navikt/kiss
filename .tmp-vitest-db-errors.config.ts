import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'app'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['app/lib/__tests__/db-errors.test.ts'],
  },
})
