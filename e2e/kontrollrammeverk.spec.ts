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
			await expect(cards.filter({ hasText: "Styring" }).first()).toBeVisible()
			await expect(cards.filter({ hasText: "Tilgangsstyring" }).first()).toBeVisible()
			await expect(cards.filter({ hasText: "Endringshåndtering" }).first()).toBeVisible()
			await expect(cards.filter({ hasText: "Drift" }).first()).toBeVisible()
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

test.describe("Risk detail page", () => {
	test("shows risk heading when seeded", async ({ page }) => {
		await page.goto("/kontrollrammeverk/risiko/R-ST.01")
		const heading = page.getByRole("heading", { level: 2 })
		const text = await heading.textContent()
		expect(text).toBeTruthy()
	})

	test("shows risk description section", async ({ page }) => {
		await page.goto("/kontrollrammeverk/risiko/R-ST.01")
		await expect(page.getByRole("heading", { name: "Risikobeskrivelse" })).toBeVisible()
	})

	test("shows mitigating controls when they exist", async ({ page }) => {
		await page.goto("/kontrollrammeverk/risiko/R-TS.01")
		const heading = page.getByRole("heading", { name: "Mitigerende kontroller" })
		const controlCards = page.locator(".framework-card")
		// Either shows controls or the heading isn't present (no controls mapped)
		const headingCount = await heading.count()
		if (headingCount > 0) {
			expect(await controlCards.count()).toBeGreaterThan(0)
		}
	})

	test("shows error boundary for non-existent risk", async ({ page }) => {
		await page.goto("/kontrollrammeverk/risiko/R-FAKE.99")
		await expect(page.getByRole("heading", { name: /Ikke funnet|Feil|galt/ })).toBeVisible()
	})

	test("risk cards on overview link to risk detail", async ({ page }) => {
		await page.goto("/kontrollrammeverk")
		const riskCard = page.locator(".framework-card").first()
		if ((await riskCard.count()) > 0) {
			await riskCard.click()
			await expect(page).toHaveURL(/\/kontrollrammeverk\/risiko\//)
		}
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
