import PDFDocument from "pdfkit"
import { afterEach, describe, expect, it, vi } from "vitest"
import { buildGithubAccessReviewPdf } from "~/lib/github-access-pdf.server"
import { type GithubAccessSubject, parseGithubAccessStagedData } from "~/lib/github-access-staged-data"

const timestamp = "2026-09-02T09:00:00.000Z"
const markedAt = "2026-09-02"
const subject: GithubAccessSubject = {
	username: "glad-fjord",
	highestPermission: "admin",
	directPermission: "admin",
	viaTeams: [],
	isNew: false,
	isGone: false,
	markedForRemoval: false,
	removalMarkedBy: null,
	removalMarkedAt: null,
	permissionAdjustmentRequested: false,
	targetPermission: null,
	permissionAdjustmentMarkedBy: null,
	permissionAdjustmentMarkedAt: null,
}

function buildData(
	subjects: GithubAccessSubject[],
	confirmedBy: string | null = null,
	confirmedAt: string | null = null,
) {
	return parseGithubAccessStagedData({
		activityType: "github_access_maintenance",
		schemaVersion: 1,
		seededAt: timestamp,
		dataSyncedAt: timestamp,
		gitRepository: "navikt/kiss",
		subjects,
		confirmedBy,
		confirmedAt,
	})
}

describe("GitHub access PDF", () => {
	afterEach(() => vi.restoreAllMocks())

	it("shows a single 'Godkjent av' line from participants, with date-only marks and no justification text", async () => {
		const textSpy = vi.spyOn(PDFDocument.prototype, "text")
		const data = buildData([
			subject,
			{
				...subject,
				username: "rask-elv",
				markedForRemoval: true,
				removalMarkedBy: "Z990002",
				removalMarkedAt: markedAt,
			},
			{
				...subject,
				username: "stille-skog",
				permissionAdjustmentRequested: true,
				targetPermission: "push",
				permissionAdjustmentMarkedBy: "Z990003",
				permissionAdjustmentMarkedAt: markedAt,
			},
		])
		const generatedAt = new Date("2026-09-02T12:00:00.000Z")
		const buffer = await buildGithubAccessReviewPdf(data, {
			performedBy: "Z990001",
			isDraft: true,
			generatedAt,
			participants: [
				{ userIdent: "Z990010", userName: "Glad Fjord", confirmedAt: null },
				{ userIdent: "Z990011", userName: "Rask Elv", confirmedAt: null },
			],
			nameByNavIdent: new Map([
				["Z990002", "Glad Fjord"],
				["Z990003", "Rask Elv"],
			]),
		})
		const texts = textSpy.mock.calls.map(([text]) => text)
		expect(buffer.subarray(0, 4).toString()).toBe("%PDF")

		const expectedDateLabel = generatedAt.toLocaleDateString("nb-NO", {
			day: "numeric",
			month: "long",
			year: "numeric",
		})
		expect(texts).toContain("Godkjent av: Glad Fjord (Z990010), Rask Elv (Z990011)")
		expect(texts.some((t) => typeof t === "string" && t.startsWith("Godkjent av:"))).toBe(true)
		expect(texts.filter((t) => typeof t === "string" && t.startsWith("Godkjent av:"))).toHaveLength(1)
		expect(texts).not.toContain(`Deltakere i gjennomgangen: Glad Fjord (Z990010), Rask Elv (Z990011)`)
		expect(texts).toContain(`Dato: ${expectedDateLabel}`)
		expect(texts).toContain(expectedDateLabel)
		expect(texts.join("\n")).not.toMatch(/Tjenstlig behov|Kompenserende|Begrunnelse for|Historisk/)
		expect(texts.join("\n")).not.toContain("KISS utfører eller bekrefter ikke endringene i GitHub")
		expect(texts.join("\n")).not.toContain("Gjennomgangen bekreftes samlet av")
		expect(texts).toContain("Registrert av")
		expect(texts).not.toContain("Gjennomgått av")
	})

	it("falls back to performedBy (via identLabel) when there are no participants", async () => {
		const textSpy = vi.spyOn(PDFDocument.prototype, "text")
		const data = buildData([subject])
		await buildGithubAccessReviewPdf(data, {
			performedBy: "Z990001",
			nameByNavIdent: new Map([["Z990001", "Glad Fjord"]]),
		})
		const texts = textSpy.mock.calls.map(([text]) => text)
		expect(texts).toContain("Godkjent av: Glad Fjord (Z990001)")
	})

	it("renders the simple Bruker/Tilgang/Tilgang via columns (no Tidspunkt/Registrert av) for plain subject tables", async () => {
		const textSpy = vi.spyOn(PDFDocument.prototype, "text")
		const data = buildData([subject, { ...subject, username: "borte-bru", isGone: true }])
		await buildGithubAccessReviewPdf(data, { performedBy: "Z990001" })
		const texts = textSpy.mock.calls.map(([text]) => text)
		expect(texts).toContain("Bruker")
		expect(texts).toContain("Tilgang")
		expect(texts).toContain("Tilgang via")
		expect(texts).not.toContain("Tidspunkt")
	})
})
