import path from "node:path"
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig, type UserProjectConfigExport } from "vitest/config"

const unitProject: UserProjectConfigExport = {
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "app"),
		},
	},
	test: {
		name: "unit",
		include: ["app/**/__tests__/**/*.test.ts", "app/**/__tests__/**/*.test.tsx"],
		exclude: ["app/**/__tests__/integration/**"],
		environment: "jsdom",
	},
}

const storybookProject: UserProjectConfigExport = {
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "app"),
		},
	},
	plugins: [storybookTest({ configDir: ".storybook" })],
	test: {
		name: "storybook",
		browser: {
			enabled: true,
			headless: true,
			provider: playwright(),
			instances: [{ browser: "chromium" }],
		},
		setupFiles: ".storybook/vitest.setup.ts",
	},
}

export default defineConfig({
	test: {
		coverage: {
			include: ["app/**"],
			exclude: ["app/**/__tests__/**", "app/**/__fixtures__/**"],
		},
		projects: [unitProject, storybookProject],
	},
})
