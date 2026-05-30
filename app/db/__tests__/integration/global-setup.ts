import { execSync } from "node:child_process"
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import pg from "pg"
import type { Vitest } from "vitest/node"

declare module "vitest" {
	export interface ProvidedContext {
		dbHost: string
		dbPort: number
		dbUser: string
		dbPassword: string
	}
}

let container: StartedPostgreSqlContainer

export async function setup(vitest: Vitest) {
	container = await new PostgreSqlContainer("postgres:17-alpine").withUsername("test").withPassword("test").start()

	const host = container.getHost()
	const port = container.getPort()
	const user = container.getUsername()
	const password = container.getPassword()
	// Default database created by the container is the username ("test")
	const adminDatabase = user

	const adminPool = new pg.Pool({ host, port, user, password, database: adminDatabase, max: 2 })
	adminPool.on("error", () => {})

	try {
		await adminPool.query("CREATE DATABASE kiss_template")

		const templateUri = `postgresql://${user}:${password}@${host}:${port}/kiss_template`
		execSync(`DATABASE_URL="${templateUri}" npx drizzle-kit push --force`, {
			cwd: process.cwd(),
			stdio: "pipe",
		})

		// Prevent connections to kiss_template so it stays clean for cloning.
		// Superusers (our test user) can still use it as a template.
		await adminPool.query("UPDATE pg_database SET datallowconn = false WHERE datname = 'kiss_template'")
	} finally {
		await adminPool.end()
	}

	vitest.provide("dbHost", host)
	vitest.provide("dbPort", port)
	vitest.provide("dbUser", user)
	vitest.provide("dbPassword", password)

	return async function teardown() {
		await container.stop()
	}
}
