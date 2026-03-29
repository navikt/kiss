import { expect, test } from "@playwright/test"

test.describe("Rapporter landing page", () => {
	test("shows main heading", async ({ page }) => {
		await page.goto("/rapporter")
		await expect(page.getByRole("heading", { level: 2 })).toContainText(/Rapporter/i)
	})
})

test.describe("Generate report page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/rapporter/generer")
	})

	test("shows heading", async ({ page }) => {
		await expect(page.getByRole("heading", { level: 2 })).toContainText(/Generer rapport/i)
	})

	test("has scope selector", async ({ page }) => {
		const select = page.locator("select").first()
		await expect(select).toBeVisible()
	})

	test("has submit button", async ({ page }) => {
		const button = page.getByRole("button", { name: /Generer/i })
		await expect(button).toBeVisible()
	})
})
