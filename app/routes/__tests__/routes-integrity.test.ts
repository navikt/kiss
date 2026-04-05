import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "../../..")

/**
 * Parse route patterns and file paths from routes.ts.
 */
function parseRoutes(): Array<{ pattern: string; file: string }> {
	const content = readFileSync(resolve(ROOT, "app/routes.ts"), "utf-8")
	const routes: Array<{ pattern: string; file: string }> = []

	// Match route("pattern", "file") — handles single-line and multi-line
	const routeRegex = /route\(\s*"([^"]+)",\s*"([^"]+)"/g
	for (const match of content.matchAll(routeRegex)) {
		routes.push({ pattern: match[1], file: match[2] })
	}

	// Match index("file")
	const indexRegex = /index\(\s*"([^"]+)"/g
	for (const match of content.matchAll(indexRegex)) {
		routes.push({ pattern: "/", file: match[1] })
	}

	return routes
}

/**
 * Check if a given path (possibly with params like ${...}) could match any route.
 */
function pathMatchesAnyRoute(path: string, routes: Array<{ pattern: string }>): boolean {
	// Strip query string before matching
	const pathWithoutQuery = path.split("?")[0]
	// Strip trailing ${...} that follows a non-/ character (query param appended to path)
	// e.g., "/admin/screening${seksjonParam}" where seksjonParam = "?seksjon=x"
	const pathClean = pathWithoutQuery.replace(/(?<=[^/])\$\{[^}]+\}$/, "")
	// Replace remaining ${...} expressions with a generic placeholder
	const resolved = pathClean.replace(/\$\{[^}]+\}/g, "PLACEHOLDER")

	return routes.some((r) => {
		// Build regex: param segments match any non-slash chars, literal segments match exactly
		const regexStr = r.pattern
			.split("/")
			.map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
			.join("/")
		const regex = new RegExp(`^/${regexStr}$`)
		return regex.test(resolved)
	})
}

/**
 * Find all redirect() calls in route action/loader functions.
 * Returns Array<{ file: string, line: number, path: string }>.
 */
function findRedirects(): Array<{ file: string; line: number; path: string; raw: string }> {
	const routes = parseRoutes()
	const results: Array<{ file: string; line: number; path: string; raw: string }> = []

	for (const route of routes) {
		const filePath = resolve(ROOT, "app", route.file)
		if (!existsSync(filePath)) continue

		const content = readFileSync(filePath, "utf-8")
		const lines = content.split("\n")

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			// Match redirect(`...`) or redirect("...")
			const redirectMatch = line.match(/redirect\(\s*[`"']([^`"']+)[`"']\s*\)/)
			if (!redirectMatch) continue

			const rawPath = redirectMatch[1]
			results.push({
				file: route.file,
				line: i + 1,
				path: rawPath,
				raw: line.trim(),
			})
		}
	}

	return results
}

/**
 * Find all Link to="..." and Button as={Link} to="..." in route components.
 * Returns Array<{ file: string, line: number, path: string }>.
 */
function findLinkTargets(): Array<{ file: string; line: number; path: string }> {
	const routes = parseRoutes()
	const results: Array<{ file: string; line: number; path: string }> = []

	for (const route of routes) {
		const filePath = resolve(ROOT, "app", route.file)
		if (!existsSync(filePath)) continue

		const content = readFileSync(filePath, "utf-8")
		const lines = content.split("\n")

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			// Match to="..." or to={`...`}
			const staticMatch = line.match(/\bto="([^"]+)"/)
			if (staticMatch) {
				results.push({ file: route.file, line: i + 1, path: staticMatch[1] })
			}
			const templateMatch = line.match(/\bto=\{`([^`]+)`\}/)
			if (templateMatch) {
				results.push({ file: route.file, line: i + 1, path: templateMatch[1] })
			}
		}
	}

	return results
}

describe("Routes integrity", () => {
	const routes = parseRoutes()

	describe("all routes in routes.ts have existing route files", () => {
		for (const route of routes) {
			it(`route file exists: ${route.file}`, () => {
				const filePath = resolve(ROOT, "app", route.file)
				expect(existsSync(filePath), `Route file missing: app/${route.file}`).toBe(true)
			})
		}
	})

	describe("all redirect() calls point to valid routes", () => {
		const redirects = findRedirects()

		for (const redir of redirects) {
			// Skip relative paths that start with "." — these are harder to validate statically
			// but absolute paths MUST match a registered route
			if (redir.path.startsWith(".")) {
				it(`redirect in ${redir.file}:${redir.line} uses relative path "${redir.path}" — should use absolute path`, () => {
					expect.fail(
						`Relative redirect found: redirect("${redir.path}") in ${redir.file}:${redir.line}. ` +
							"Use absolute paths to prevent resolution errors.",
					)
				})
			} else {
				it(`redirect in ${redir.file}:${redir.line} → "${redir.path}" matches a registered route`, () => {
					const matches = pathMatchesAnyRoute(redir.path, routes)
					expect(matches, `No route matches redirect path "${redir.path}" in ${redir.file}:${redir.line}`).toBe(true)
				})
			}
		}
	})

	describe("Link/Button targets point to valid routes", () => {
		const links = findLinkTargets()
		const absoluteLinks = links.filter(
			(l) => l.path.startsWith("/") && !l.path.startsWith("//") && !l.path.includes("github.com"),
		)

		for (const link of absoluteLinks) {
			it(`link in ${link.file}:${link.line} → "${link.path}" matches a registered route`, () => {
				const matches = pathMatchesAnyRoute(link.path, routes)
				expect(matches, `No route matches link path "${link.path}" in ${link.file}:${link.line}`).toBe(true)
			})
		}
	})
})
