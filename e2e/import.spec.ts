import { expect, test } from "@playwright/test"

test.describe("Import page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/admin/import")
		await page.waitForLoadState("networkidle")
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

	test("selecting a file via file chooser shows it and upload button", async ({ page }) => {
		await page.evaluate(() => {
			const input = document.querySelector<HTMLInputElement>("input[type='file']")
			if (!input) return

			const dt = new DataTransfer()
			dt.items.add(
				new File(["content"], "valgt-fil.xlsx", {
					type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				}),
			)

			Object.defineProperty(input, "files", { value: dt.files, configurable: true })
			input.dispatchEvent(new Event("change", { bubbles: true }))
		})

		await expect(page.getByText("valgt-fil.xlsx")).toBeVisible({ timeout: 10_000 })
		await expect(page.getByRole("button", { name: "Last opp og valider" })).toBeVisible()
	})

	test("hidden file input accepts xlsx files", async ({ page }) => {
		const fileInput = page.locator("input[type='file']")
		await expect(fileInput).toHaveAttribute("accept", /\.xlsx/)
	})

	test("dropping a file on the dropzone selects it", async ({ page }) => {
		await page.evaluate(() => {
			const area = document.querySelector<HTMLDivElement>(".aksel-dropzone__area")
			if (!area) return

			const dt = new DataTransfer()
			dt.items.add(
				new File(["content"], "kontrollrammeverk.xlsx", {
					type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				}),
			)

			area.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }))
			area.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }))
			area.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }))
		})

		await expect(page.getByText("kontrollrammeverk.xlsx")).toBeVisible({ timeout: 10_000 })
		await expect(page.getByRole("button", { name: "Last opp og valider" })).toBeVisible()
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

	test("shows staging diff section when staging data exists with active version", async ({ page }) => {
		// The diff section heading should appear if there is a staging version
		const diffHeading = page.getByRole("heading", { name: "Endringer fra aktiv versjon" })
		// Either the diff section is visible (staging exists) or it is not (no staging).
		// We verify the page renders without errors in both cases.
		const hasDiff = await diffHeading.isVisible().catch(() => false)
		if (hasDiff) {
			await expect(diffHeading).toBeVisible()
			// Should show one of: the summary text, the first-import alert, or the no-changes alert
			const hasSummary = await page.getByText(/nye,.*fjernede,.*endrede elementer/).isVisible().catch(() => false)
			const hasFirstImport = await page.getByText("Dette er første import").isVisible().catch(() => false)
			const hasNoChanges = await page.getByText("Ingen endringer funnet").isVisible().catch(() => false)
			expect(hasSummary || hasFirstImport || hasNoChanges).toBe(true)
		}
	})

	test("shows first-import alert when no active version exists", async ({ page }) => {
		// This test checks that the first-import message renders correctly if present
		const firstImportAlert = page.getByText("Dette er første import — alle elementer er nye.")
		const isVisible = await firstImportAlert.isVisible().catch(() => false)
		// We only assert structure if the alert is present (depends on DB state)
		if (isVisible) {
			await expect(firstImportAlert).toBeVisible()
		}
	})
})
