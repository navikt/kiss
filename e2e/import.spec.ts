import { expect, test } from "@playwright/test"
import path from "node:path"

test.describe("Import page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/import")
	})

	test("shows dropzone with label", async ({ page }) => {
		const dropzone = page.getByText("Last opp Excel-fil (.xlsx)")
		await expect(dropzone).toBeVisible()
	})

	test("shows upload button only after file selection", async ({ page }) => {
		const uploadButton = page.getByRole("button", { name: "Last opp og valider" })
		await expect(uploadButton).not.toBeVisible()
	})

	test("accepts file via file chooser (click)", async ({ page }) => {
		const fileChooserPromise = page.waitForEvent("filechooser")
		await page.getByText("Last opp Excel-fil (.xlsx)").click()
		const fileChooser = await fileChooserPromise
		expect(fileChooser.isMultiple()).toBe(false)
	})

	test("shows selected file and upload button after drop", async ({ page }) => {
		const testFile = path.resolve(__dirname, "fixtures/test-framework.xlsx")

		const dropzone = page.locator(".navds-file-upload__dropzone")
		await expect(dropzone).toBeVisible()

		const dataTransfer = await page.evaluateHandle(async (filePath) => {
			const dt = new DataTransfer()
			const response = await fetch(`/__test-fixture?path=${encodeURIComponent(filePath)}`)
			if (!response.ok) {
				// Create a minimal valid .xlsx-like file for testing
				const blob = new Blob(["test"], {
					type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				})
				const file = new File([blob], "test-framework.xlsx", {
					type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				})
				dt.items.add(file)
			}
			return dt
		}, testFile)

		await dropzone.dispatchEvent("drop", { dataTransfer })

		const fileItem = page.locator(".navds-file-upload__item")
		await expect(fileItem).toBeVisible({ timeout: 5000 })

		const uploadButton = page.getByRole("button", { name: "Last opp og valider" })
		await expect(uploadButton).toBeVisible()
	})

	test("shows delete button to remove selected file", async ({ page }) => {
		// Select a file via the input
		const dropzone = page.locator(".navds-file-upload__dropzone")
		await expect(dropzone).toBeVisible()

		const dataTransfer = await page.evaluateHandle(() => {
			const dt = new DataTransfer()
			const file = new File(["test"], "test.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			})
			dt.items.add(file)
			return dt
		})

		await dropzone.dispatchEvent("drop", { dataTransfer })

		const fileItem = page.locator(".navds-file-upload__item")
		await expect(fileItem).toBeVisible({ timeout: 5000 })

		// Click delete button
		const deleteButton = fileItem.getByRole("button")
		await deleteButton.click()

		// File item should be removed
		await expect(fileItem).not.toBeVisible()

		// Upload button should also be gone
		const uploadButton = page.getByRole("button", { name: "Last opp og valider" })
		await expect(uploadButton).not.toBeVisible()
	})

	test("rejects non-xlsx files via drop", async ({ page }) => {
		const dropzone = page.locator(".navds-file-upload__dropzone")
		await expect(dropzone).toBeVisible()

		const dataTransfer = await page.evaluateHandle(() => {
			const dt = new DataTransfer()
			const file = new File(["test"], "test.pdf", { type: "application/pdf" })
			dt.items.add(file)
			return dt
		})

		await dropzone.dispatchEvent("drop", { dataTransfer })

		// Should show error, not a file item with upload button
		const uploadButton = page.getByRole("button", { name: "Last opp og valider" })
		await expect(uploadButton).not.toBeVisible({ timeout: 3000 })
	})
})
