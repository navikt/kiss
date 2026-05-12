import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ACTIVITY_TYPE_GROUPS, activityTypeLabels } from "~/lib/activity-types"
import { ActivityTypeOptions } from "../ActivityTypeOptions"

afterEach(() => cleanup())

describe("ActivityTypeOptions", () => {
	function renderInSelect() {
		return render(
			<select data-testid="select">
				<ActivityTypeOptions />
			</select>,
		)
	}

	it("renders the empty 'Ingen' option first", () => {
		renderInSelect()
		const options = screen.getAllByRole("option")
		expect(options[0].textContent).toBe("Ingen")
		expect((options[0] as HTMLOptionElement).value).toBe("")
	})

	it("renders an optgroup for each activity type group", () => {
		renderInSelect()
		const optgroups = screen.getAllByRole("group")
		expect(optgroups).toHaveLength(ACTIVITY_TYPE_GROUPS.length)
		for (const group of ACTIVITY_TYPE_GROUPS) {
			expect(screen.getByRole("group", { name: group.label })).toBeDefined()
		}
	})

	it("renders an option for each activity type with correct label", () => {
		renderInSelect()
		for (const group of ACTIVITY_TYPE_GROUPS) {
			for (const type of group.types) {
				const option = screen.getByRole("option", { name: activityTypeLabels[type] })
				expect(option).toBeDefined()
				expect((option as HTMLOptionElement).value).toBe(type)
			}
		}
	})

	it("renders the correct total number of options (all types + 'Ingen')", () => {
		renderInSelect()
		const totalTypes = ACTIVITY_TYPE_GROUPS.reduce((sum, g) => sum + g.types.length, 0)
		const options = screen.getAllByRole("option")
		// +1 for the "Ingen" option
		expect(options).toHaveLength(totalTypes + 1)
	})
})
