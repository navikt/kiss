import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	GithubAccessMaintenanceSection,
	type GithubAccessSubjectWithIdentity,
} from "~/routes/seksjoner.$seksjon.rutiner.$rutineId.gjennomgang.$gjennomgangId/components/activities/GithubAccessMaintenanceSection"

const submit = vi.hoisted(() => vi.fn())
vi.mock("react-router", () => ({ useFetcher: () => ({ submit, state: "idle" }) }))

const subject: GithubAccessSubjectWithIdentity = {
	username: "glad-fjord",
	highestPermission: "admin",
	directPermission: "admin",
	viaTeams: [],
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
			gitRepository="navikt/kiss"
			subjects={subjects}
			confirmedBy={props.confirmedBy ?? null}
			confirmedAt={props.confirmedAt ?? null}
			confirmedByName={props.confirmedByName ?? null}
			isDraft
		/>,
	)
}

describe("GitHub access maintenance UI", () => {
	beforeEach(() => submit.mockClear())
	afterEach(() => cleanup())

	it("has no per-subject approval form, justification text, or bulk-select controls", () => {
		renderSection()
		expect(screen.queryByLabelText("Tjenstlig behov")).toBeNull()
		expect(screen.queryByRole("button", { name: "Godkjenn tilgang" })).toBeNull()
		expect(screen.queryByRole("checkbox", { name: "Velg alle synlige" })).toBeNull()
		expect(screen.queryByRole("checkbox", { name: `Velg ${subject.username}` })).toBeNull()
		expect(screen.queryByText("Gjennomgått av")).toBeNull()
	})

	it("marks removal without a reason or dialog, via a direct 'Fjern'-button", () => {
		renderSection()
		fireEvent.click(screen.getByRole("button", { name: `Fjern tilgang for ${subject.username}` }))
		expect(screen.queryByRole("textbox")).toBeNull()
		expect(submit).toHaveBeenCalledWith(
			{ intent: "mark-github-access-subject-for-removal", username: subject.username },
			{ method: "POST" },
		)
	})

	it("marks adjustment with a target permission but no reason, via an 'Endre'-dialog", () => {
		renderSection()
		fireEvent.click(screen.getByRole("button", { name: `Endre tilgang for ${subject.username}` }))
		expect(screen.queryByRole("textbox")).toBeNull()
		fireEvent.change(screen.getByLabelText("Nytt tilgangsnivå"), { target: { value: "push" } })
		fireEvent.click(screen.getByRole("button", { name: "Merk for justering" }))
		expect(submit).toHaveBeenCalledWith(
			{ intent: "mark-github-access-subject-for-adjustment", username: subject.username, targetPermission: "push" },
			{ method: "POST" },
		)
	})

	it("moves a removal-marked subject out of the main table and into 'Tilganger som skal endres', with an Angre-button", () => {
		renderSection([{ ...subject, markedForRemoval: true, removalMarkedBy: "Z990002", removalMarkedAt: "2026-09-02" }])
		expect(screen.getByText("Tilganger som skal endres (1)")).toBeDefined()
		expect(screen.queryByRole("button", { name: `Fjern tilgang for ${subject.username}` })).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: `Angre markering for ${subject.username}` }))
		expect(submit).toHaveBeenCalledWith(
			{ intent: "unmark-github-access-subject-for-removal", username: subject.username },
			{ method: "POST" },
		)
	})

	it("submits the single confirm-review intent via the fetcher", () => {
		renderSection()
		expect(screen.queryByText("Ikke bekreftet")).toBeNull()
		fireEvent.click(screen.getByRole("button", { name: "Bekreft tjenstlig behov resterende" }))
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
		fireEvent.click(screen.getByRole("button", { name: "Bekreft tjenstlig behov resterende" }))
		expect(submit).toHaveBeenCalledWith({ intent: "confirm-github-access-review" }, { method: "POST" })
	})

	it("shows team access directly in the Kilde column without a dropdown, hides Nav-ident, and shows name + github username", () => {
		renderSection([
			{
				...subject,
				displayName: "Glad Fjord",
				navIdent: "Z990001",
				directPermission: null,
				viaTeams: [{ teamSlug: "teampensjon", teamName: "teampensjon", permission: "maintain" }],
			},
		])
		expect(screen.getByText("Via team teampensjon:")).toBeDefined()
		expect(screen.getByRole("link", { name: "Glad Fjord (glad-fjord)" })).toBeDefined()
		expect(screen.queryByText("Z990001")).toBeNull()
		expect(screen.queryByRole("button", { name: /vis detaljer|ekspander/i })).toBeNull()
	})
})
