import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema/index"

const pool = new Pool({
	connectionString: process.env.DATABASE_URL ?? "postgresql://kiss:kiss@localhost:5432/kiss",
	max: 10,
})

export const db = drizzle(pool, { schema })
export { pool }
