import { execSync } from "node:child_process"
import path from "node:path"
import { reactRouter } from "@react-router/dev/vite"
import { defineConfig } from "vite"

function getBuildVersion(): string {
	const now = new Date()
	const time = now
		.toLocaleString("sv-SE", { timeZone: "Europe/Oslo", hour12: false })
		.replace(/[-: ]/g, (m) => (m === " " ? "-" : m === ":" ? "." : "."))
		.replace(",", "")
		.slice(0, 16)

	let sha: string
	if (process.env.GITHUB_SHA) {
		sha = process.env.GITHUB_SHA.substring(0, 12)
	} else {
		try {
			sha = execSync("git rev-parse --short=12 HEAD", { encoding: "utf-8", cwd: __dirname }).trim()
		} catch {
			sha = "unknown"
		}
	}

	return `${time}-${sha}`
}

export default defineConfig({
	plugins: [reactRouter()],
	define: {
		__BUILD_VERSION__: JSON.stringify(getBuildVersion()),
	},
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "app"),
		},
	},
	server: {
		port: 3000,
	},
})
