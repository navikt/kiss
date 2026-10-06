import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { GithubAccessSubject } from "~/lib/github-access-staged-data"
import { GithubAccessMaintenanceSection } from "~/routes/seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/activities/GithubAccessMaintenanceSection"

const submit = vi.hoisted(() => vi.fn())
vi.mock("react-router", () => ({ useFetcher: () => ({ submit }) }))

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

function renderSection(
	subjects = [subject],
	props: Partial<{ confirmedBy: string | null; confirmedAt: string | null; confirmedByName: string | null }> = {},
) {
	return render(
		<GithubAccessMaintenanceSection
			activity={{
				id: "activity-1",
				type: "github_access_maintenance",
				status: "pending",
				completedAt: null,
				createdAt: "2026-09-01T00:00:00Z",
				changes: [],
			}}
			reviewId="review-1"
			gitRepository="navikt/kiss"
			subjects={subjects}
			confirmedBy={props.confirmedBy ?? null}
			confirmedAt={props.confirmedAt ?? null}
			confirmedByName={props.confirmedByName ?? null}
			isDraft
		/>,
	)
}

function expandSubject() {
	const button = screen.getByRole("link", { name: subject.username }).closest("tr")?.querySelector("button")
	if (!button) throw new Error("Missing expandable row button")
	fireEvent.click(button)
}

function openActionMenu() {
	fireEvent.click(screen.getByRole("button", { name: `Handlinger for ${subject.username}` }))
}

describe("GitHub access maintenance UI", () => {
	beforeEach(() => submit.mockClear())
	afterEach(() => cleanup())

	it("has no per-subject approval form, justification text, or bulk-select controls", () => {
		renderSection()
		expandSubject()
		expect(screen.queryByLabelText("Tjenstlig behov")).toBeNull()
		expect(screen.queryByRole("button", { name: "Godkjenn tilgang" })).toBeNull()
		expect(screen.queryByRole("checkbox", { name: "Velg alle synlige" })).toBeNull()
		expect(screen.queryByRole("checkbox", { name: `Velg ${subject.username}` })).toBeNull()
		expect(screen.queryByText("Gjennomgått av")).toBeNull()
	})

	it("marks removal without a reason and does not promise a GitHub change", () => {
		renderSection()
		openActionMenu()
		fireEvent.click(screen.getByRole("menuitem", { name: "Fjern tilgang" }))
		expect(screen.queryByRole("textbox")).toBeNull()
		expect(screen.getByText(/KISS utfører eller bekrefter ikke/)).toBeDefined()
		fireEvent.click(screen.getByRole("button", { name: "Merk for fjerning" }))
		expect(submit).toHaveBeenCalledWith(
			{ intent: "mark-github-access-subject-for-removal", username: subject.username },
			{ method: "POST" },
		)
	})

	it("marks adjustment with a target permission but no reason", () => {
		renderSection()
		openActionMenu()
		fireEvent.click(screen.getByRole("menuitem", { name: "Juster tilgang" }))
		expect(screen.queryByRole("textbox")).toBeNull()
		fireEvent.change(screen.getByLabelText("Nytt tilgangsnivå"), { target: { value: "push" } })
		fireEvent.click(screen.getByRole("button", { name: "Merk for justering" }))
		expect(submit).toHaveBeenCalledWith(
			{ intent: "mark-github-access-subject-for-adjustment", username: subject.username, targetPermission: "push" },
			{ method: "POST" },
		)
	})

	it("allows undoing a removal mark via the Handlinger menu", () => {
		renderSection([{ ...subject, markedForRemoval: true, removalMarkedBy: "Z990002", removalMarkedAt: "2026-09-02" }])
		openActionMenu()
		fireEvent.click(screen.getByRole("menuitem", { name: "Angre — behold tilgangen i stedet" }))
		expect(submit).toHaveBeenCalledWith(
			{ intent: "unmark-github-access-subject-for-removal", username: subject.username },
			{ method: "POST" },
		)
	})

	it("submits the single confirm-review intent via the fetcher", () => {
		renderSection()
		expect(screen.queryByText("Ikke bekreftet")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Bekreft tjenstlig behov for alle" }))
		expect(submit).toHaveBeenCalledWith({ intent: "confirm-github-access-review" }, { method: "POST" })
	})

	it("shows a confirmed status line with actor and date once confirmedAt is set", () => {
		renderSection([subject], {
			confirmedBy: "Z990001",
			confirmedAt: "2026-09-02T10:00:00.000Z",
			confirmedByName: "Glad Fjord",
		})
		expect(screen.getByText("Bekreftet")).toBeDefined()
		expect(screen.getByText(/Bekreftet av/)).toBeDefined()
		expect(screen.getByText(/Glad Fjord/)).toBeDefined()
	})

	it("allows reconfirming even after confirmedAt is already set", () => {
		renderSection([subject], { confirmedBy: "Z990001", confirmedAt: "2026-09-02T10:00:00.000Z" })
		fireEvent.click(screen.getByRole("button", { name: "Bekreft tjenstlig behov for alle" }))
		expect(submit).toHaveBeenCalledWith({ intent: "confirm-github-access-review" }, { method: "POST" })
	})
})
