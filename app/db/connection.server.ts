import { Pool } from "pg"

const pool = new Pool({
	connectionString: process.env.DATABASE_URL ?? "postgresql://kiss:kiss@localhost:5432/kiss",
	max: 10,
})

export { pool }
