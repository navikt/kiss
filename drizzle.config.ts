import { defineConfig } from "drizzle-kit"

export default defineConfig({
	dialect: "postgresql",
	schema: "./app/db/schema/index.ts",
	out: "./drizzle",
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/kiss",
	},
})
