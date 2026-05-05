import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useFetcher } from "react-router"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ParticipantSearchDialog } from "../ParticipantSearchDialog"

vi.mock("react-router", () => ({
	useFetcher: vi.fn(),
}))

const mockUseFetcher = vi.mocked(useFetcher)

function buildFetcher(overrides: { state?: string; data?: { results: unknown[] } } = {}) {
	return {
		state: overrides.state ?? "idle",
		data: overrides.data ?? undefined,
		load: vi.fn(),
	}
}

/** Opens the dialog by clicking the trigger button. */
function openDialog() {
	fireEvent.click(screen.getByRole("button", { name: /søk etter person/i }))
}

/** Types a query into the search box and advances timers to trigger the debounced search. */
function typeAndSearch(value: string) {
	fireEvent.change(screen.getByRole("searchbox"), { target: { value } })
	act(() => {
		vi.advanceTimersByTime(300)
	})
}

/** Returns the footer "Lukk" close button (last of the two "Lukk" buttons). */
function getFooterCloseButton() {
	const buttons = screen.getAllByRole("button", { name: /lukk/i })
	return buttons[buttons.length - 1]
}

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	vi.useRealTimers()
})

describe("ParticipantSearchDialog", () => {
	describe("trigger button", () => {
		it("renders the trigger button", () => {
			mockUseFetcher.mockReturnValue(buildFetcher() as unknown as ReturnType<typeof useFetcher>)
			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			expect(screen.getByRole("button", { name: /søk etter person/i })).toBeDefined()
		})
	})

	describe("dialog open/close", () => {
		beforeEach(() => {
			mockUseFetcher.mockReturnValue(buildFetcher() as unknown as ReturnType<typeof useFetcher>)
		})

		it("opens the dialog and shows the search field when trigger is clicked", () => {
			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			expect(screen.getByRole("searchbox")).toBeDefined()
		})

		it("closes the dialog when the footer close button is clicked", () => {
			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			expect(screen.getByRole("searchbox")).toBeDefined()
			fireEvent.click(getFooterCloseButton())
			expect(screen.queryByRole("searchbox")).toBeNull()
		})
	})

	describe("debounce behaviour", () => {
		it("does not call fetcher.load for queries shorter than 2 characters", () => {
			vi.useFakeTimers()
			const fetcher = buildFetcher()
			mockUseFetcher.mockReturnValue(fetcher as unknown as ReturnType<typeof useFetcher>)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			fireEvent.change(screen.getByRole("searchbox"), { target: { value: "A" } })
			act(() => {
				vi.advanceTimersByTime(400)
			})

			expect(fetcher.load).not.toHaveBeenCalled()
		})

		it("calls fetcher.load after 300 ms for a query of 2+ characters", () => {
			vi.useFakeTimers()
			const fetcher = buildFetcher()
			mockUseFetcher.mockReturnValue(fetcher as unknown as ReturnType<typeof useFetcher>)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			fireEvent.change(screen.getByRole("searchbox"), { target: { value: "An" } })

			expect(fetcher.load).not.toHaveBeenCalled()
			act(() => {
				vi.advanceTimersByTime(300)
			})
			expect(fetcher.load).toHaveBeenCalledOnce()
			expect(fetcher.load).toHaveBeenCalledWith("/api/graph/users?q=An")
		})

		it("debounces: only fires once when typing fast", () => {
			vi.useFakeTimers()
			const fetcher = buildFetcher()
			mockUseFetcher.mockReturnValue(fetcher as unknown as ReturnType<typeof useFetcher>)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			const input = screen.getByRole("searchbox")

			fireEvent.change(input, { target: { value: "An" } })
			act(() => {
				vi.advanceTimersByTime(100)
			})
			fireEvent.change(input, { target: { value: "And" } })
			act(() => {
				vi.advanceTimersByTime(100)
			})
			fireEvent.change(input, { target: { value: "Ande" } })
			act(() => {
				vi.advanceTimersByTime(300)
			})

			expect(fetcher.load).toHaveBeenCalledOnce()
			expect(fetcher.load).toHaveBeenCalledWith("/api/graph/users?q=Ande")
		})
	})

	describe("timeout cancellation", () => {
		it("cancels a pending search when the input is cleared", () => {
			vi.useFakeTimers()
			const fetcher = buildFetcher()
			mockUseFetcher.mockReturnValue(fetcher as unknown as ReturnType<typeof useFetcher>)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			fireEvent.change(screen.getByRole("searchbox"), { target: { value: "An" } })

			const clearButton = screen.getByRole("button", { name: /tøm/i })
			fireEvent.click(clearButton)
			act(() => {
				vi.advanceTimersByTime(400)
			})

			expect(fetcher.load).not.toHaveBeenCalled()
		})

		it("cancels a pending search when the footer close button is clicked", () => {
			vi.useFakeTimers()
			const fetcher = buildFetcher()
			mockUseFetcher.mockReturnValue(fetcher as unknown as ReturnType<typeof useFetcher>)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			fireEvent.change(screen.getByRole("searchbox"), { target: { value: "An" } })

			fireEvent.click(getFooterCloseButton())
			act(() => {
				vi.advanceTimersByTime(400)
			})

			expect(fetcher.load).not.toHaveBeenCalled()
		})

		it("cancels a pending search when the header close (X) button is clicked", () => {
			vi.useFakeTimers()
			const fetcher = buildFetcher()
			mockUseFetcher.mockReturnValue(fetcher as unknown as ReturnType<typeof useFetcher>)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			fireEvent.change(screen.getByRole("searchbox"), { target: { value: "An" } })

			// Header close button is the first "Lukk" button (the X icon)
			const headerCloseButton = screen.getAllByRole("button", { name: /lukk/i })[0]
			fireEvent.click(headerCloseButton)
			act(() => {
				vi.advanceTimersByTime(400)
			})

			expect(fetcher.load).not.toHaveBeenCalled()
		})

		it("cancels a pending search on unmount", () => {
			vi.useFakeTimers()
			const fetcher = buildFetcher()
			mockUseFetcher.mockReturnValue(fetcher as unknown as ReturnType<typeof useFetcher>)

			const { unmount } = render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			fireEvent.change(screen.getByRole("searchbox"), { target: { value: "An" } })

			act(() => {
				unmount()
			})
			act(() => {
				vi.advanceTimersByTime(400)
			})

			expect(fetcher.load).not.toHaveBeenCalled()
		})
	})

	describe("result rendering", () => {
		it("shows a loading message while searching", () => {
			vi.useFakeTimers()
			mockUseFetcher.mockReturnValue(buildFetcher({ state: "loading" }) as unknown as ReturnType<typeof useFetcher>)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			typeAndSearch("An")

			expect(screen.getByText(/søker/i)).toBeDefined()
		})

		it("shows results returned by the fetcher", () => {
			vi.useFakeTimers()
			mockUseFetcher.mockReturnValue(
				buildFetcher({
					data: {
						results: [
							{ navIdent: "A123456", displayName: "Ola Nordmann", mail: "ola@nav.no" },
							{ navIdent: "B654321", displayName: "Kari Nordmann", mail: null },
						],
					},
				}) as unknown as ReturnType<typeof useFetcher>,
			)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			typeAndSearch("No")

			expect(screen.getByText("Ola Nordmann")).toBeDefined()
			expect(screen.getByText("Kari Nordmann")).toBeDefined()
		})

		it("shows 'Ingen brukere funnet' when results are empty", () => {
			vi.useFakeTimers()
			mockUseFetcher.mockReturnValue(
				buildFetcher({ data: { results: [] } }) as unknown as ReturnType<typeof useFetcher>,
			)

			render(<ParticipantSearchDialog currentValue="" onAdd={vi.fn()} />)
			openDialog()
			typeAndSearch("xx")

			expect(screen.getByText(/ingen brukere funnet/i)).toBeDefined()
		})
	})

	describe("disabled state for already-added participants", () => {
		it("disables the button for a participant already in the list", () => {
			vi.useFakeTimers()
			mockUseFetcher.mockReturnValue(
				buildFetcher({
					data: {
						results: [{ navIdent: "A123456", displayName: "Ola Nordmann", mail: null }],
					},
				}) as unknown as ReturnType<typeof useFetcher>,
			)

			render(<ParticipantSearchDialog currentValue="A123456" onAdd={vi.fn()} />)
			openDialog()
			typeAndSearch("Ol")

			const resultButton = screen.getByRole("button", { name: /ola nordmann/i })
			expect((resultButton as HTMLButtonElement).disabled).toBe(true)
		})

		it("disables case-insensitively when participant is already in the list", () => {
			vi.useFakeTimers()
			mockUseFetcher.mockReturnValue(
				buildFetcher({
					data: {
						results: [{ navIdent: "a123456", displayName: "Ola Nordmann", mail: null }],
					},
				}) as unknown as ReturnType<typeof useFetcher>,
			)

			render(<ParticipantSearchDialog currentValue="A123456" onAdd={vi.fn()} />)
			openDialog()
			typeAndSearch("Ol")

			const resultButton = screen.getByRole("button", { name: /ola nordmann/i })
			expect((resultButton as HTMLButtonElement).disabled).toBe(true)
		})

		it("does not disable the button for a participant not yet in the list", () => {
			vi.useFakeTimers()
			mockUseFetcher.mockReturnValue(
				buildFetcher({
					data: {
						results: [{ navIdent: "A123456", displayName: "Ola Nordmann", mail: null }],
					},
				}) as unknown as ReturnType<typeof useFetcher>,
			)

			render(<ParticipantSearchDialog currentValue="B654321" onAdd={vi.fn()} />)
			openDialog()
			typeAndSearch("Ol")

			const resultButton = screen.getByRole("button", { name: /ola nordmann/i })
			expect((resultButton as HTMLButtonElement).disabled).toBe(false)
		})

		it("calls onAdd with the navIdent when a non-disabled result is clicked", () => {
			vi.useFakeTimers()
			const onAdd = vi.fn()
			mockUseFetcher.mockReturnValue(
				buildFetcher({
					data: {
						results: [{ navIdent: "A123456", displayName: "Ola Nordmann", mail: null }],
					},
				}) as unknown as ReturnType<typeof useFetcher>,
			)

			render(<ParticipantSearchDialog currentValue="" onAdd={onAdd} />)
			openDialog()
			typeAndSearch("Ol")
			fireEvent.click(screen.getByRole("button", { name: /ola nordmann/i }))

			expect(onAdd).toHaveBeenCalledOnce()
			expect(onAdd).toHaveBeenCalledWith("A123456")
		})

		it("does not call onAdd when an already-added participant button is clicked", () => {
			vi.useFakeTimers()
			const onAdd = vi.fn()
			mockUseFetcher.mockReturnValue(
				buildFetcher({
					data: {
						results: [{ navIdent: "A123456", displayName: "Ola Nordmann", mail: null }],
					},
				}) as unknown as ReturnType<typeof useFetcher>,
			)

			render(<ParticipantSearchDialog currentValue="A123456" onAdd={onAdd} />)
			openDialog()
			typeAndSearch("Ol")
			fireEvent.click(screen.getByRole("button", { name: /ola nordmann/i }))

			expect(onAdd).not.toHaveBeenCalled()
		})
	})
})
