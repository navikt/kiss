import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const documents = pgTable("documents", {
	id: uuid("id").primaryKey().defaultRandom(),
	title: text("title").notNull(),
	description: text("description"),
	originalFileName: text("original_file_name").notNull(),
	contentType: text("content_type").notNull(),
	sizeBytes: integer("size_bytes").notNull(),
	bucketPath: text("bucket_path").notNull(),
	uploadedBy: text("uploaded_by").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	archivedBy: text("archived_by"),
})
