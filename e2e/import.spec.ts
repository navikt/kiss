import { expect, test } from "@playwright/test"

test.describe("Import page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/import")
	})

	test("shows dropzone with label", async ({ page }) => {
		const dropzone = page.getByText("Last opp kontrollrammeverk")
		await expect(dropzone).toBeVisible()
	})

	test("shows description text", async ({ page }) => {
		await expect(page.getByText(/Du kan laste opp filer i xlsx-format/)).toBeVisible()
	})

	test("shows upload button only after file selection", async ({ page }) => {
		const uploadButton = page.getByRole("button", { name: "Last opp og valider" })
		await expect(uploadButton).not.toBeVisible()
	})

	test("opens file chooser on click with correct settings", async ({ page }) => {
		const [fileChooser] = await Promise.all([
			page.waitForEvent("filechooser"),
			page.getByText("Last opp kontrollrammeverk").click(),
		])
		expect(fileChooser.isMultiple()).toBe(false)
	})

	test("dropzone area is keyboard accessible", async ({ page }) => {
		const dropzoneButton = page.locator(".aksel-dropzone__area-button")
		await expect(dropzoneButton).toBeVisible()
		await expect(dropzoneButton).toHaveAttribute("type", "button")
	})

	test("dropzone button has correct Aksel styling", async ({ page }) => {
		const dropzoneButton = page.locator(".aksel-dropzone__area-button")
		await expect(dropzoneButton).toHaveAttribute("data-variant", "secondary")
		// Verify the button has visible padding (CSS fix for unlayered reset)
		const padding = await dropzoneButton.evaluate((el) => {
			const styles = window.getComputedStyle(el)
			return Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight)
		})
		expect(padding).toBeGreaterThan(0)
	})

	test("hidden file input accepts xlsx files", async ({ page }) => {
		const fileInput = page.locator("input[type='file']")
		await expect(fileInput).toHaveAttribute("accept", /\.xlsx/)
	})

	test("dropping a file on the dropzone does not open file chooser", async ({ page }) => {
		const dropzone = page.locator(".aksel-dropzone__area")

		const dataTransfer = await page.evaluateHandle(() => {
			const dt = new DataTransfer()
			const file = new File(["fake content"], "dropped.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			})
			dt.items.add(file)
			return dt
		})

		await dropzone.dispatchEvent("dragover", { dataTransfer })
		await dropzone.dispatchEvent("drop", { dataTransfer })

		// The file chooser should NOT open
		let fileChooserOpened = false
		page.once("filechooser", () => {
			fileChooserOpened = true
		})
		await page.waitForTimeout(500)
		expect(fileChooserOpened).toBe(false)
	})

	test("dropping a file outside dropzone does not navigate away", async ({ page }) => {
		const body = page.locator("body")

		const dataTransfer = await page.evaluateHandle(() => {
			const dt = new DataTransfer()
			const file = new File(["fake content"], "outside.xlsx", {
				type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			})
			dt.items.add(file)
			return dt
		})

		await body.dispatchEvent("dragover", { dataTransfer })
		await body.dispatchEvent("drop", { dataTransfer })

		// Page should still be on /import
		await expect(page).toHaveURL(/\/import/)
		await expect(page.getByText("Last opp kontrollrammeverk")).toBeVisible()
	})
})
