import type { StorybookConfig } from "@storybook/react-vite"
import type { Plugin } from "vite"

/**
 * Replaces .server.ts file contents with no-op stubs so server-only code
 * (process.env, Node APIs, auth, DB) never runs in the browser.
 * Preserves all export names so importing modules don't break.
 */
function stubServerModules(): Plugin {
	return {
		name: "stub-server-modules",
		enforce: "pre",
		transform(code, id) {
			if (!id.includes(".server.")) return

			const stubs: string[] = []
			const names = new Set<string>()

			// export enum Name { ... } → preserve as empty enum
			for (const m of code.matchAll(/export\s+enum\s+(\w+)\s*\{[^}]*\}/g)) {
				stubs.push(`export enum ${m[1]} {}`)
				names.add(m[1])
			}

			// export class Name → stub as empty class
			for (const m of code.matchAll(/export\s+class\s+(\w+)/g)) {
				stubs.push(`export class ${m[1]} {}`)
				names.add(m[1])
			}

			// export const/let/var/function/async function name
			for (const m of code.matchAll(/export\s+(?:async\s+)?(?:const|let|var|function)\s+(\w+)/g)) {
				if (!names.has(m[1])) {
					stubs.push(`export const ${m[1]} = () => {}`)
					names.add(m[1])
				}
			}

			// export { name, name as alias }
			for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
				for (const part of m[1].split(",")) {
					const alias = part
						.trim()
						.split(/\s+as\s+/)
						.pop()
						?.trim()
					if (alias && !names.has(alias)) {
						stubs.push(`export const ${alias} = () => {}`)
						names.add(alias)
					}
				}
			}

			if (/export\s+default/.test(code)) stubs.push("export default () => {}")

			return { code: stubs.join("\n"), map: null }
		},
	}
}

const config: StorybookConfig = {
	stories: ["../app/**/*.stories.@(ts|tsx)"],
	addons: ["@storybook/addon-vitest"],
	framework: "@storybook/react-vite",
	async viteFinal(config) {
		const path = await import("node:path")
		const url = await import("node:url")
		const currentDir = path.dirname(url.fileURLToPath(import.meta.url))
		config.plugins = config.plugins || []
		config.plugins.push(stubServerModules())
		config.resolve = config.resolve || {}
		config.resolve.alias = {
			...config.resolve.alias,
			"@storybook-mocks": path.resolve(currentDir, "mocks"),
		}
		config.define = {
			...config.define,
			__BUILD_VERSION__: JSON.stringify("storybook-dev"),
		}
		return config
	},
}

export default config
