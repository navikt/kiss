import { expect, test } from "@playwright/test"

test.describe("Applikasjoner list", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/applikasjoner")
	})

	test("shows main heading", async ({ page }) => {
		await expect(page.getByRole("heading", { level: 2 })).toContainText("Applikasjoner")
	})

	test("displays application table", async ({ page }) => {
		const table = page.getByRole("table")
		await expect(table).toBeVisible()
	})

	test("table has expected column headers", async ({ page }) => {
		await expect(page.getByRole("columnheader", { name: /Applikasjon/i })).toBeVisible()
		await expect(page.getByRole("columnheader", { name: /Team/i })).toBeVisible()
		await expect(page.getByRole("columnheader", { name: /Compliance/i })).toBeVisible()
	})
})

test.describe("Compliance assessment page", () => {
	test("navigates to compliance from application list when seeded", async ({ page }) => {
		await page.goto("/applikasjoner")
		const complianceLink = page.getByRole("link", { name: /Vurder/i }).first()
		const linkVisible = await complianceLink.isVisible().catch(() => false)
		if (!linkVisible) {
			test.skip()
			return
		}
		await complianceLink.click()
		await expect(page.getByRole("heading", { level: 2 })).toContainText("Compliance-vurdering")
	})

	test("compliance form has status dropdown and comment field when seeded", async ({ page }) => {
		await page.goto("/applikasjoner")
		const complianceLink = page.getByRole("link", { name: /Vurder/i }).first()
		const linkVisible = await complianceLink.isVisible().catch(() => false)
		if (!linkVisible) {
			test.skip()
			return
		}
		await complianceLink.click()
		await expect(page.locator("select").first()).toBeVisible()
		await expect(page.locator("textarea").first()).toBeVisible()
	})
})
