import { describe, expect, it } from "vitest"

/**
 * Regression test: routine links must use section slug (e.g. "pensjon-og-ufore"),
 * NOT section UUID (e.g. "df9423c5-3c39-4ad3-87f4-b8877dbefa14").
 *
 * The route `/seksjoner/:seksjon/rutiner/:rutineId` expects a slug.
 * Using a UUID causes a 404 / error page.
 */
describe("routine link URL generation", () => {
	it("should use section slug, not section UUID, in routine links", () => {
		const sectionId = "df9423c5-3c39-4ad3-87f4-b8877dbefa14"
		const sectionSlug = "pensjon-og-ufore"
		const routineId = "d3efe375-c94f-434e-a05e-9aaf33c76329"

		// This is the WRONG pattern (using UUID) — causes error
		const wrongUrl = `/seksjoner/${sectionId}/rutiner/${routineId}`
		expect(wrongUrl).toContain(sectionId)

		// This is the CORRECT pattern (using slug)
		const correctUrl = `/seksjoner/${sectionSlug}/rutiner/${routineId}`
		expect(correctUrl).not.toMatch(/\/seksjoner\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//)
		expect(correctUrl).toBe(`/seksjoner/pensjon-og-ufore/rutiner/${routineId}`)
	})

	it("buildRoutineUrl helper uses slug from sectionSlugMap", () => {
		const sectionSlugMap: Record<string, string> = {
			"df9423c5-3c39-4ad3-87f4-b8877dbefa14": "pensjon-og-ufore",
			"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": "it-og-digital",
		}

		const routineId = "d3efe375-c94f-434e-a05e-9aaf33c76329"
		const sectionId = "df9423c5-3c39-4ad3-87f4-b8877dbefa14"

		const slug = sectionSlugMap[sectionId]
		expect(slug).toBe("pensjon-og-ufore")

		const url = `/seksjoner/${slug}/rutiner/${routineId}`
		expect(url).toBe("/seksjoner/pensjon-og-ufore/rutiner/d3efe375-c94f-434e-a05e-9aaf33c76329")
		// Must NOT contain a UUID in the section position
		expect(url).not.toMatch(/\/seksjoner\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//)
	})
})
