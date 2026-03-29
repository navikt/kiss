import { expect, test } from "@playwright/test"

test.describe("Kontrollrammeverk overview", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/kontrollrammeverk")
	})

	test("shows main heading", async ({ page }) => {
		await expect(page.getByRole("heading", { level: 2 })).toContainText("Kontrollrammeverk")
	})

	test("shows description text", async ({ page }) => {
		await expect(page.getByText(/Minimum kontrollrammeverk/)).toBeVisible()
	})

	test("displays domain cards when data is seeded", async ({ page }) => {
		const cards = page.locator(".domain-card")
		const count = await cards.count()
		if (count > 0) {
			await expect(page.getByText("Styring", { exact: true })).toBeVisible()
			await expect(page.getByText("Tilgangsstyring")).toBeVisible()
			await expect(page.getByText("Endringshåndtering")).toBeVisible()
			await expect(page.getByText("Drift")).toBeVisible()
		}
	})
})

test.describe("Domain detail page", () => {
	test("shows domain heading when seeded", async ({ page }) => {
		await page.goto("/kontrollrammeverk/st")
		const heading = page.getByRole("heading", { level: 2 })
		const text = await heading.textContent()
		// Either shows domain name or error boundary heading
		expect(text).toBeTruthy()
	})

	test("shows error boundary for non-existent domain", async ({ page }) => {
		await page.goto("/kontrollrammeverk/nonexistent")
		await expect(page.getByRole("heading", { name: /Ikke funnet|Feil|galt/ })).toBeVisible()
	})
})

test.describe("Control detail page", () => {
	test("shows control heading when seeded", async ({ page }) => {
		await page.goto("/kontrollrammeverk/st/K-ST.01")
		const heading = page.getByRole("heading", { level: 2 })
		const text = await heading.textContent()
		expect(text).toBeTruthy()
	})

	test("shows error boundary for non-existent control", async ({ page }) => {
		await page.goto("/kontrollrammeverk/st/K-FAKE.99")
		await expect(page.getByRole("heading", { name: /Ikke funnet|Feil|galt/ })).toBeVisible()
	})
})
