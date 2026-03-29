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
})
