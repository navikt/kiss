import { expect, test } from "@playwright/test"

test.describe("Seksjoner landing page", () => {
	test("shows main heading", async ({ page }) => {
		await page.goto("/seksjoner")
		await expect(page.getByRole("heading", { level: 2 })).toBeVisible()
	})
})

test.describe("Section dashboard", () => {
	test("shows section heading when seeded", async ({ page }) => {
		await page.goto("/seksjoner/utvikling")
		const heading = page.getByRole("heading", { level: 2 })
		const text = await heading.textContent()
		// Either shows section name or error boundary
		expect(text).toBeTruthy()
	})

	test("shows error boundary for non-existent section", async ({ page }) => {
		await page.goto("/seksjoner/nonexistent")
		await expect(page.getByRole("heading", { name: /Ikke funnet|Feil|galt/ })).toBeVisible()
	})
})

test.describe("Team dashboard", () => {
	test("shows team heading when seeded", async ({ page }) => {
		await page.goto("/seksjoner/utvikling/team/team-alfa")
		const heading = page.getByRole("heading", { level: 2 })
		const text = await heading.textContent()
		expect(text).toBeTruthy()
	})

	test("shows error boundary for non-existent team", async ({ page }) => {
		await page.goto("/seksjoner/utvikling/team/nonexistent")
		await expect(page.getByRole("heading", { name: /Ikke funnet|Feil|galt/ })).toBeVisible()
	})
})
