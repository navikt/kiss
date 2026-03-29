import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "app"),
		},
	},
	test: {
		include: ["app/**/__tests__/**/*.test.ts", "app/**/__tests__/**/*.test.tsx"],
		exclude: ["app/**/__tests__/integration/**"],
		environment: "jsdom",
		coverage: {
			include: ["app/**"],
			exclude: ["app/**/__tests__/**", "app/**/__fixtures__/**"],
		},
	},
})
