import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AutoUploadDropzone } from "../AutoUploadDropzone"

const baseProps = {
	label: "Dra og slipp fil",
	description: "Maks 10 MB",
	accept: ".pdf,.xlsx",
	maxSizeInBytes: 10 * 1024 * 1024,
	files: [],
	onFilesChange: vi.fn(),
	isUploading: false,
}

describe("AutoUploadDropzone", () => {
	it("renders dropzone with label and description", () => {
		render(<AutoUploadDropzone {...baseProps} />)
		expect(screen.getByText("Dra og slipp fil")).toBeDefined()
		expect(screen.getByText("Maks 10 MB")).toBeDefined()
	})

	it("renders accepted file with idle status", () => {
		const file = new File(["content"], "rapport.pdf", { type: "application/pdf" })
		const { container } = render(<AutoUploadDropzone {...baseProps} files={[{ file, error: false }]} />)
		expect(container.textContent).toContain("rapport.pdf")
	})

	it("renders file and does not crash when isUploading", () => {
		const file = new File(["content"], "rapport.pdf", { type: "application/pdf" })
		const { container } = render(
			<AutoUploadDropzone {...baseProps} files={[{ file, error: false }]} isUploading={true} />,
		)
		expect(container.textContent).toContain("rapport.pdf")
	})

	it("renders rejected file with default error message", () => {
		const file = new File(["content"], "bilde.gif", { type: "image/gif" })
		render(<AutoUploadDropzone {...baseProps} files={[{ file, error: true, reasons: ["fileType"] }]} />)
		expect(screen.getByText("bilde.gif")).toBeDefined()
		expect(screen.getByText("Filtypen støttes ikke.")).toBeDefined()
	})

	it("renders rejected file with custom error message", () => {
		const file = new File(["content"], "stor.pdf", { type: "application/pdf" })
		render(
			<AutoUploadDropzone
				{...baseProps}
				files={[{ file, error: true, reasons: ["fileSize"] }]}
				rejectionErrors={{ fileSize: "Filen er over 10 MB." }}
			/>,
		)
		expect(screen.getByText("Filen er over 10 MB.")).toBeDefined()
	})

	it("calls onFilesChange([]) and onFilesClear when delete button is clicked on accepted file", () => {
		const onFilesChange = vi.fn()
		const onFilesClear = vi.fn()
		const file = new File(["content"], "rapport.pdf", { type: "application/pdf" })

		render(
			<AutoUploadDropzone
				{...baseProps}
				files={[{ file, error: false }]}
				onFilesChange={onFilesChange}
				onFilesClear={onFilesClear}
			/>,
		)

		const deleteButtons = screen.getAllByRole("button", { name: /slett/i })
		fireEvent.click(deleteButtons[deleteButtons.length - 1])

		expect(onFilesChange).toHaveBeenCalledWith([])
		expect(onFilesClear).toHaveBeenCalled()
	})

	it("calls onFilesChange when delete button is clicked on rejected file", () => {
		const onFilesChange = vi.fn()
		const file = new File(["content"], "bilde.gif", { type: "image/gif" })
		const rejectedFile = { file, error: true as const, reasons: ["fileType" as const] }

		render(<AutoUploadDropzone {...baseProps} files={[rejectedFile]} onFilesChange={onFilesChange} />)

		const deleteButtons = screen.getAllByRole("button", { name: /slett/i })
		fireEvent.click(deleteButtons[deleteButtons.length - 1])

		expect(onFilesChange).toHaveBeenCalledWith([])
	})

	it("calls onFilesClear when deleting last rejected file empties the list", () => {
		const onFilesChange = vi.fn()
		const onFilesClear = vi.fn()
		const file = new File(["content"], "bilde.gif", { type: "image/gif" })
		const rejectedFile = { file, error: true as const, reasons: ["fileType" as const] }

		render(
			<AutoUploadDropzone
				{...baseProps}
				files={[rejectedFile]}
				onFilesChange={onFilesChange}
				onFilesClear={onFilesClear}
			/>,
		)

		const deleteButtons = screen.getAllByRole("button", { name: /slett/i })
		fireEvent.click(deleteButtons[deleteButtons.length - 1])

		expect(onFilesChange).toHaveBeenCalledWith([])
		expect(onFilesClear).toHaveBeenCalled()
	})
})
