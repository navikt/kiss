import { expect, test } from "@playwright/test"

test.describe("Dashboard", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/")
	})

	test("shows main heading", async ({ page }) => {
		await expect(page.getByRole("heading", { level: 2 })).toContainText("Dashboard")
	})

	test("displays compliance metrics section", async ({ page }) => {
		await expect(page.getByText("Total compliance")).toBeVisible()
		await expect(page.getByText("Totalt kontroller")).toBeVisible()
	})

	test("shows domain status section heading", async ({ page }) => {
		await expect(page.getByText("Status per domene")).toBeVisible()
	})

	test("displays domain compliance cards when data is seeded", async ({ page }) => {
		const domainCard = page.locator(".domain-status-card")
		const count = await domainCard.count()
		if (count > 0) {
			await expect(page.getByText("Styring", { exact: true })).toBeVisible()
			await expect(page.getByText("Tilgangsstyring")).toBeVisible()
			await expect(page.getByText("Endringshåndtering")).toBeVisible()
			await expect(page.getByText("Drift")).toBeVisible()
		}
	})
})
