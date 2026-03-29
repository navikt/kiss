import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

export const bucketObjects = pgTable("bucket_objects", {
	id: uuid("id").primaryKey().defaultRandom(),
	bucketName: text("bucket_name").notNull(),
	objectPath: text("object_path").notNull(),
	contentType: text("content_type").notNull(),
	sizeBytes: integer("size_bytes"),
	objectType: text("object_type").notNull(),
	uploadedBy: text("uploaded_by").notNull(),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
	metadata: text("metadata"),
})
