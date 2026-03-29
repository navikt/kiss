import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
	testDir: "e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: "html",
	use: {
		baseURL: "http://localhost:3000",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "mobile",
			use: { ...devices["iPhone 13"] },
		},
		{
			name: "tablet",
			use: { ...devices["iPad (gen 7)"] },
		},
		{
			name: "desktop",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "pnpm dev",
		url: "http://localhost:3000",
		reuseExistingServer: !process.env.CI,
	},
})
