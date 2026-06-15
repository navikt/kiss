import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createRoutesStub } from "react-router"
import { afterEach, describe, expect, it } from "vitest"
import { activityTypeLabels } from "~/lib/activity-types"
import type { ActivityItem } from "../SortableActivityList"
import { SortableActivityList } from "../SortableActivityList"

afterEach(() => cleanup())

function getSelectElement(container: HTMLElement) {
	return container.querySelector("select") as HTMLSelectElement
}

function toItems(...types: string[]): ActivityItem[] {
	return types.map((t) => ({ id: t, type: t as ActivityItem["type"] }))
}

/** Wraps SortableActivityList in a minimal router context (required by MarkdownEditor). */
function renderWithRouter(props: Parameters<typeof SortableActivityList>[0] = {}) {
	const Stub = createRoutesStub([{ path: "/", Component: () => <SortableActivityList {...props} /> }])
	return render(<Stub initialEntries={["/"]} />)
}

describe("SortableActivityList", () => {
	describe("hidden input JSON output", () => {
		it("outputs empty array when no activities selected", () => {
			render(<SortableActivityList />)
			const hidden = document.querySelector('input[name="activityItems"]') as HTMLInputElement
			expect(hidden).not.toBeNull()
			expect(JSON.parse(hidden.value)).toEqual([])
		})

		it("outputs initial activities as JSON array", () => {
			const activities = toItems("oracle_evidence_audit", "entra_id_group_maintenance")
			render(<SortableActivityList initialActivities={activities} />)
			const hidden = document.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]
			expect(parsed.map((a) => a.type)).toEqual(["oracle_evidence_audit", "entra_id_group_maintenance"])
		})

		it("uses custom name for hidden input", () => {
			render(<SortableActivityList name="customField" />)
			const hidden = document.querySelector('input[name="customField"]') as HTMLInputElement
			expect(hidden).not.toBeNull()
		})

		it("preserves order from initialActivities", () => {
			const activities = toItems("deployment_evidence_report", "oracle_evidence_audit", "entra_id_group_maintenance")
			render(<SortableActivityList initialActivities={activities} />)
			const hidden = document.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]
			expect(parsed.map((a) => a.type)).toEqual([
				"deployment_evidence_report",
				"oracle_evidence_audit",
				"entra_id_group_maintenance",
			])
		})
	})

	describe("rendering", () => {
		it("renders activity labels for each initial activity", () => {
			const activities = toItems("oracle_evidence_audit", "entra_id_group_maintenance")
			render(<SortableActivityList initialActivities={activities} />)

			expect(screen.getByText(activityTypeLabels.oracle_evidence_audit)).toBeDefined()
			expect(screen.getByText(activityTypeLabels.entra_id_group_maintenance)).toBeDefined()
		})

		it("shows index tags starting from #1", () => {
			const activities = toItems("oracle_evidence_audit", "entra_id_group_maintenance")
			render(<SortableActivityList initialActivities={activities} />)

			expect(screen.getByText("#1")).toBeDefined()
			expect(screen.getByText("#2")).toBeDefined()
		})

		it("shows empty state message when no activities", () => {
			render(<SortableActivityList />)
			expect(
				screen.getByText("Ingen vedlikeholdsaktiviteter valgt. Gjennomganger vil ikke inkludere aktivitetssteg."),
			).toBeDefined()
		})

		it("hides empty state when disabled", () => {
			render(<SortableActivityList disabled />)
			expect(
				screen.queryByText("Ingen vedlikeholdsaktiviteter valgt. Gjennomganger vil ikke inkludere aktivitetssteg."),
			).toBeNull()
		})
	})

	describe("adding activities", () => {
		it("adds a new activity via select and button", () => {
			const { container } = render(<SortableActivityList />)

			const select = getSelectElement(container)
			// React 19 with jsdom needs native value setter + event dispatch
			select.value = "oracle_evidence_audit"
			select.dispatchEvent(new Event("change", { bubbles: true }))

			const addButton = screen.getByRole("button", { name: /Legg til/i })
			fireEvent.click(addButton)

			const hidden = container.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]
			expect(parsed.map((a) => a.type)).toEqual(["oracle_evidence_audit"])
		})

		it("prevents adding duplicate activity", () => {
			const activities = toItems("oracle_evidence_audit")
			const { container } = render(<SortableActivityList initialActivities={activities} />)

			// oracle_evidence_audit should not be in the select options
			const select = getSelectElement(container)
			const options = Array.from(select.querySelectorAll("option"))
			const oracleOption = options.find((o) => o.value === "oracle_evidence_audit")
			expect(oracleOption).toBeUndefined()
		})

		it("resets select value after adding", () => {
			const { container } = render(<SortableActivityList />)

			const select = getSelectElement(container)
			select.value = "oracle_evidence_audit"
			select.dispatchEvent(new Event("change", { bubbles: true }))

			const addButton = screen.getByRole("button", { name: /Legg til/i })
			fireEvent.click(addButton)

			expect(select.value).toBe("")
		})

		it("disables add button when no selection", () => {
			render(<SortableActivityList />)
			const addButton = screen.getByRole("button", { name: /Legg til/i })
			expect(addButton).toHaveProperty("disabled", true)
		})
	})

	describe("removing activities", () => {
		it("removes an activity when clicking Fjern", () => {
			const activities = toItems("oracle_evidence_audit", "entra_id_group_maintenance")
			const { container } = render(<SortableActivityList initialActivities={activities} />)

			const removeButtons = screen.getAllByRole("button", { name: /Fjern/i })
			fireEvent.click(removeButtons[0])

			const hidden = container.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]
			expect(parsed.map((a) => a.type)).toEqual(["entra_id_group_maintenance"])
		})

		it("makes removed activity available in select again", () => {
			const activities = toItems("oracle_evidence_audit")
			const { container } = render(<SortableActivityList initialActivities={activities} />)

			const removeButtons = screen.getAllByRole("button", { name: /Fjern/i })
			fireEvent.click(removeButtons[0])

			const select = getSelectElement(container)
			const options = Array.from(select.querySelectorAll("option"))
			const oracleOption = options.find((o) => o.value === "oracle_evidence_audit")
			expect(oracleOption).toBeDefined()
		})
	})

	describe("disabled state", () => {
		it("hides remove buttons when disabled", () => {
			const activities = toItems("oracle_evidence_audit")
			render(<SortableActivityList initialActivities={activities} disabled />)

			const removeButtons = screen.queryAllByRole("button", { name: /Fjern/i })
			expect(removeButtons).toHaveLength(0)
		})

		it("hides add controls when disabled", () => {
			const activities = toItems("oracle_evidence_audit")
			render(<SortableActivityList initialActivities={activities} disabled />)

			expect(screen.queryByRole("combobox")).toBeNull()
			expect(screen.queryByRole("button", { name: /Legg til/i })).toBeNull()
		})

		it("hides drag handles when disabled", () => {
			const activities = toItems("oracle_evidence_audit")
			render(<SortableActivityList initialActivities={activities} disabled />)

			const dragHandles = screen.queryAllByRole("button", {
				name: /Dra for å endre rekkefølge/i,
			})
			expect(dragHandles).toHaveLength(0)
		})
	})

	describe("manual_activity items", () => {
		it("allows adding manual_activity multiple times", () => {
			const { container } = renderWithRouter()
			const select = getSelectElement(container)

			// Add first manual_activity step
			select.value = "manual_activity"
			select.dispatchEvent(new Event("change", { bubbles: true }))
			fireEvent.click(screen.getByRole("button", { name: /Legg til/i }))

			// Add second manual_activity step
			select.value = "manual_activity"
			select.dispatchEvent(new Event("change", { bubbles: true }))
			fireEvent.click(screen.getByRole("button", { name: /Legg til/i }))

			const hidden = container.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]
			expect(parsed.filter((a) => a.type === "manual_activity")).toHaveLength(2)
		})

		it("renders title and description fields for manual_activity", () => {
			const activities: ActivityItem[] = [
				{ id: "step-1", type: "manual_activity", stepTitle: "Bekreft tilgang", stepDescription: "Beskrivelse" },
			]
			renderWithRouter({ initialActivities: activities })

			expect(screen.getByLabelText(/Tittel på steg/i)).toBeDefined()
			expect(screen.getByLabelText(/Beskrivelse/i)).toBeDefined()
		})

		it("includes stepTitle and stepDescription in JSON output", () => {
			const activities: ActivityItem[] = [
				{
					id: "step-1",
					type: "manual_activity",
					stepTitle: "Bekreft tilgang",
					stepDescription: "Sjekk rettigheter",
				},
			]
			const { container } = renderWithRouter({ initialActivities: activities })
			const hidden = container.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]

			expect(parsed[0].stepTitle).toBe("Bekreft tilgang")
			expect(parsed[0].stepDescription).toBe("Sjekk rettigheter")
		})

		it("outputs stepComponents in JSON for manual_activity items", () => {
			const activities: ActivityItem[] = [
				{
					id: "step-1",
					type: "manual_activity",
					stepTitle: "Steg",
					stepDescription: undefined,
					stepComponents: [
						{ type: "notater", required: true },
						{ type: "lenker", required: false },
					],
				},
			]
			const { container } = renderWithRouter({ initialActivities: activities })
			const hidden = container.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]

			expect(parsed[0].stepComponents).toEqual([
				{ type: "notater", required: true },
				{ type: "lenker", required: false },
			])
		})

		it("omits stepComponents from JSON for non-manual activities", () => {
			const activities = toItems("oracle_evidence_audit")
			const { container } = render(<SortableActivityList initialActivities={activities} />)
			const hidden = container.querySelector('input[name="activityItems"]') as HTMLInputElement
			const parsed = JSON.parse(hidden.value) as ActivityItem[]

			expect(Object.keys(parsed[0])).not.toContain("stepComponents")
		})

		it("renders component checkboxes for manual_activity", () => {
			const activities: ActivityItem[] = [
				{
					id: "step-1",
					type: "manual_activity",
					stepTitle: "Steg",
					stepDescription: undefined,
					stepComponents: [],
				},
			]
			renderWithRouter({ initialActivities: activities })

			expect(screen.getByLabelText(/Notater/i)).toBeDefined()
			expect(screen.getByLabelText(/Lenker/i)).toBeDefined()
			expect(screen.getByLabelText(/Vedlegg/i)).toBeDefined()
		})

		it("reflects pre-selected stepComponents as checked checkboxes", () => {
			const activities: ActivityItem[] = [
				{
					id: "step-1",
					type: "manual_activity",
					stepTitle: "Steg",
					stepDescription: undefined,
					stepComponents: [{ type: "notater", required: false }],
				},
			]
			renderWithRouter({ initialActivities: activities })

			const notaterCheckbox = screen.getByLabelText(/^Notater/i) as HTMLInputElement
			expect(notaterCheckbox.checked).toBe(true)

			const lenkerCheckbox = screen.getByLabelText(/^Lenker/i) as HTMLInputElement
			expect(lenkerCheckbox.checked).toBe(false)
		})
	})
})
