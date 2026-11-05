import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { createRoutesStub } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	getSectionDetail: vi.fn(),
	deployments: vi.fn().mockResolvedValue({ appsWithData: 0 }),
	screening: vi.fn().mockResolvedValue(new Map()),
	routines: vi.fn().mockResolvedValue(new Map()),
	sectionRoutines: vi.fn().mockResolvedValue(0),
	followUp: vi.fn().mockResolvedValue(0),
}))

vi.mock("~/db/queries/sections.server", () => ({
	getSectionDetail: mocks.getSectionDetail,
	countSectionRoutinesIncomplete: mocks.sectionRoutines,
}))
vi.mock("~/db/queries/deployment-audit.server", () => ({
	getDeploymentVerificationAggregate: mocks.deployments,
}))
vi.mock("~/db/queries/screening.server", () => ({
	getScreeningProgressForApps: mocks.screening,
}))
vi.mock("~/db/queries/application-controls.server", () => ({
	getRoutineComplianceSummaries: mocks.routines,
}))
vi.mock("~/db/queries/routines.server", () => ({
	countOpenFollowUpPointsForApps: mocks.followUp,
}))
vi.mock("~/db/queries/economy-classification.server", () => ({
	countSectionEconomySystems: vi.fn().mockResolvedValue({ totalCount: 1, expiredCount: 0 }),
}))
vi.mock("~/db/queries/rulesets.server", () => ({
	resolveRoleHolder: vi.fn().mockResolvedValue(null),
}))
vi.mock("~/lib/auth.server", () => ({
	getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}))
vi.mock("~/lib/authorization.server", () => ({
	canManageSection: vi.fn(),
	canViewSectionReports: vi.fn(),
	isAdmin: vi.fn(),
}))

const { default: SeksjonDashboard, loader } = await import("../index")

function sectionDetail(economyOnly: boolean) {
	const stats = {
		apps: economyOnly ? 1 : 2,
		implemented: 1,
		partial: 0,
		notImplemented: economyOnly ? 0 : 1,
		notRelevant: 0,
		total: economyOnly ? 1 : 2,
	}
	return {
		section: { id: "section-1", name: "Pensjon og uføre" },
		allAppIds: economyOnly ? ["economy-app"] : ["economy-app", "other-app"],
		teams: [{ slug: "team", name: "Testteam", ...stats }],
		unassignedStats: { apps: 0 },
		sectionTotals: stats,
		hasNaisTeam: true,
		hasNaisMiljo: true,
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.deployments.mockResolvedValue({ appsWithData: 0 })
	mocks.getSectionDetail.mockImplementation((_, options) => sectionDetail(options.economyOnly))
})

afterEach(cleanup)

describe("section dashboard economy filter", () => {
	it.each([false, true])(
		"uses the selected application scope for every aggregate (economyOnly=%s)",
		async (economyOnly) => {
			const appIds = economyOnly ? ["economy-app"] : ["economy-app", "other-app"]
			const request = new Request(
				`http://localhost/seksjoner/pensjon-og-ufore${economyOnly ? "?economyOnly=true" : ""}`,
			)
			const result = await loader({
				request,
				params: { seksjon: "pensjon-og-ufore" },
				context: {},
			} as Parameters<typeof loader>[0])

			expect(mocks.getSectionDetail).toHaveBeenCalledWith("pensjon-og-ufore", {
				economyOnly,
			})
			expect(mocks.deployments).toHaveBeenCalledWith(appIds)
			expect(mocks.screening).toHaveBeenCalledWith(appIds, ["section-1"])
			expect(mocks.routines).toHaveBeenCalledWith(appIds)
			expect(mocks.sectionRoutines).toHaveBeenCalledWith(appIds)
			expect(mocks.followUp).toHaveBeenCalledWith("section-1", appIds)
			expect(result.data.totalApps).toBe(appIds.length)
			expect(result.data.overallPercent).toBe(economyOnly ? 100 : 50)
		},
	)

	it("reloads the card totals when toggled on and off, preserving other query parameters", async () => {
		const requestUrls: URL[] = []
		const Stub = createRoutesStub([
			{
				path: "/seksjoner/:seksjon",
				Component: SeksjonDashboard,
				HydrateFallback: () => null,
				loader: (args) => {
					requestUrls.push(new URL(args.request.url))
					return loader(args as Parameters<typeof loader>[0])
				},
			},
		])
		render(createElement(Stub, { initialEntries: ["/seksjoner/pensjon-og-ufore?view=overview"] }))
		const toggle = await screen.findByRole("checkbox", { name: "Vis kun økonomisystemer" })
		const compliance = screen.getByText("Total compliance", { selector: "p" }).parentElement
		const applications = screen.getByText("Applikasjoner", { selector: "p" }).parentElement
		expect(compliance?.textContent).toContain("50%")
		expect(applications?.textContent).toBe("2Applikasjoner")

		fireEvent.click(toggle)
		await waitFor(() => expect(compliance?.textContent).toContain("100%"))
		expect(applications?.textContent).toBe("1Applikasjoner")
		expect(mocks.getSectionDetail).toHaveBeenLastCalledWith("pensjon-og-ufore", { economyOnly: true })
		expect(screen.getByRole("checkbox", { checked: true })).toBe(toggle)
		expect(requestUrls.at(-1)?.searchParams.get("view")).toBe("overview")

		fireEvent.click(toggle)
		await waitFor(() => expect(compliance?.textContent).toContain("50%"))
		expect(applications?.textContent).toBe("2Applikasjoner")
		expect(mocks.getSectionDetail).toHaveBeenLastCalledWith("pensjon-og-ufore", { economyOnly: false })
		expect(requestUrls.at(-1)?.searchParams.get("view")).toBe("overview")
		expect(requestUrls.at(-1)?.searchParams.has("economyOnly")).toBe(false)
	})
})

describe("section dashboard metric explanations", () => {
	it.each([false, true])("documents every visible card, including optional cards (%s)", async (showOptionalCards) => {
		mocks.deployments.mockResolvedValue({
			appsWithData: showOptionalCards ? 1 : 0,
			fourEyesTotal: 10,
			fourEyesApproved: 8,
			fourEyesPercent: 80,
			changeOriginTotal: 10,
			changeOriginLinked: 9,
			changeOriginPercent: 90,
		})
		if (showOptionalCards) {
			mocks.getSectionDetail.mockImplementation((_, options) => {
				const detail = sectionDetail(options.economyOnly)
				return { ...detail, unassignedStats: { ...detail.sectionTotals, apps: 1 } }
			})
		}
		const Stub = createRoutesStub([
			{
				path: "/seksjoner/:seksjon",
				Component: SeksjonDashboard,
				HydrateFallback: () => null,
				loader: (args) => loader(args as Parameters<typeof loader>[0]),
			},
		])
		const { container } = render(
			createElement(Stub, { initialEntries: ["/seksjoner/pensjon-og-ufore?economyOnly=true"] }),
		)
		fireEvent.click(await screen.findByRole("button", { name: "Hva betyr tallene?" }))

		const cardLabels = [...container.querySelectorAll(".aksel-detail")]
			.filter((label) => [...(label.parentElement?.children ?? [])].some((child) => child.tagName === "H3"))
			.map((label) => label.textContent)
		expect(cardLabels.length).toBeGreaterThan(0)
		for (const label of cardLabels) {
			expect(screen.getByText(label ?? "", { selector: "strong" })).toBeTruthy()
		}
		expect(Boolean(screen.queryByText("Deployments i år", { selector: "strong" }))).toBe(showOptionalCards)
		expect(Boolean(screen.queryByText("Uten team", { selector: "strong" }))).toBe(showOptionalCards)
	})
})
