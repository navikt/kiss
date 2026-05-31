import { execSync } from "node:child_process"
import path from "node:path"
import { reactRouter } from "@react-router/dev/vite"
import { defineConfig } from "vite"

const isStorybook = !!process.env.STORYBOOK

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
	plugins: [...(!isStorybook ? [reactRouter()] : [])],
	define: {
		__BUILD_VERSION__: JSON.stringify(getBuildVersion()),
	},
	resolve: {
		alias: {
			"~": path.resolve(__dirname, "app"),
		},
	},
	ssr: {
		// archiver is CJS-only and has no ESM default export. Bundling it lets
		// Vite/Rollup produce an ESM-compatible wrapper instead of leaving it
		// as an external import that Node.js 22 would reject at startup.
		noExternal: ["archiver"],
	},
	server: {
		port: 3000,
	},
})
