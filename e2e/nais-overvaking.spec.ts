import { expect, test } from "@playwright/test"

test.describe("Nais-overvåking", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/nais-overvaking")
	})

	test("shows main heading", async ({ page }) => {
		await expect(page.getByRole("heading", { level: 2 })).toContainText(/Nais/i)
	})

	test("displays team table", async ({ page }) => {
		const table = page.getByRole("table")
		await expect(table).toBeVisible()
	})

	test("table has expected columns", async ({ page }) => {
		await expect(page.getByRole("columnheader", { name: /Team/i })).toBeVisible()
		await expect(page.getByRole("columnheader", { name: /Status/i })).toBeVisible()
	})

	test("shows sync button", async ({ page }) => {
		await expect(page.getByRole("button", { name: /Synkroniser nå/i })).toBeVisible()
	})

	test("shows empty state when no teams", async ({ page }) => {
		const emptyMsg = page.getByText(/Ingen Nais-team oppdaget/i)
		const teamRows = page.getByRole("row").filter({ hasText: /Overvåket|Venter|Ignorert/ })
		const hasTeams = (await teamRows.count()) > 0
		if (!hasTeams) {
			await expect(emptyMsg).toBeVisible()
		}
	})
})
