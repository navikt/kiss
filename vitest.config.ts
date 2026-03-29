import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		include: ["app/**/__tests__/**/*.test.ts", "app/**/__tests__/**/*.test.tsx"],
		exclude: ["app/**/__tests__/integration/**"],
		coverage: {
			include: ["app/**"],
			exclude: ["app/**/__tests__/**", "app/**/__fixtures__/**"],
		},
	},
})
