import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "app"),
		},
	},
	test: {
		include: ["app/**/__tests__/integration/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
})
