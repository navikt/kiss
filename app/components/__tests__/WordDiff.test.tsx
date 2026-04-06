import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { WordDiff } from "../WordDiff"

describe("WordDiff", () => {
	it("shows (tom) when both values are null", () => {
		render(<WordDiff oldValue={null} newValue={null} side="old" />)
		expect(screen.getByText("(tom)")).toBeDefined()
	})

	it("shows (tom) for old side when old is empty and new has content", () => {
		const { container } = render(<WordDiff oldValue="" newValue="ny tekst" side="old" />)
		expect(container.textContent).toBe("(tom)")
	})

	it("shows added text highlighted on new side", () => {
		const { container } = render(<WordDiff oldValue="" newValue="ny tekst" side="new" />)
		const added = container.querySelector(".word-diff--added")
		expect(added).not.toBeNull()
		expect(added?.textContent).toBe("ny tekst")
	})

	it("highlights removed words on old side", () => {
		const { container } = render(<WordDiff oldValue="alfa beta gamma" newValue="alfa gamma" side="old" />)
		const removed = container.querySelector(".word-diff--removed")
		expect(removed).not.toBeNull()
		expect(removed?.textContent).toContain("beta")
	})

	it("highlights added words on new side", () => {
		const { container } = render(<WordDiff oldValue="alfa gamma" newValue="alfa beta gamma" side="new" />)
		const added = container.querySelector(".word-diff--added")
		expect(added).not.toBeNull()
		expect(added?.textContent).toContain("beta")
	})

	it("does not show removed words on new side", () => {
		const { container } = render(<WordDiff oldValue="alfa beta gamma" newValue="alfa gamma" side="new" />)
		const removed = container.querySelector(".word-diff--removed")
		expect(removed).toBeNull()
	})

	it("renders unchanged text without highlighting", () => {
		const { container } = render(<WordDiff oldValue="samme tekst" newValue="samme tekst" side="old" />)
		expect(container.querySelector(".word-diff--removed")).toBeNull()
		expect(container.querySelector(".word-diff--added")).toBeNull()
		expect(container.textContent).toBe("samme tekst")
	})

	it("highlights changed words in the middle of a sentence", () => {
		const { container } = render(
			<WordDiff
				oldValue="Kontroll utføres månedlig etter plan"
				newValue="Kontroll utføres kvartalsvis etter plan"
				side="old"
			/>,
		)
		const removed = container.querySelector(".word-diff--removed")
		expect(removed?.textContent).toContain("månedlig")
	})
})
