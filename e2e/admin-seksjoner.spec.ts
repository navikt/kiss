import { expect, test } from "@playwright/test"

test.describe("Admin Seksjoner", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/admin/seksjoner")
	})

	test("shows main heading", async ({ page }) => {
		await expect(page.getByRole("heading", { level: 2, name: "Administrer seksjoner" })).toBeVisible()
	})

	test("shows create section form", async ({ page }) => {
		await expect(page.getByRole("textbox", { name: "Seksjonsnavn" })).toBeVisible()
		await expect(page.getByRole("button", { name: "Opprett seksjon" })).toBeVisible()
	})

	test("can create a section", async ({ page }) => {
		const uniqueName = `Testseksjon ${Date.now()}`
		await page.getByRole("textbox", { name: "Seksjonsnavn" }).fill(uniqueName)
		await page.getByRole("textbox", { name: "Beskrivelse" }).first().fill("En testbeskrivelse")
		await page.getByRole("button", { name: "Opprett seksjon" }).click()

		await expect(page.getByText(`Seksjon «${uniqueName}» opprettet.`)).toBeVisible()
		await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible()
	})

	test("can create a team in a section", async ({ page }) => {
		const sectionName = `Seksjon-team ${Date.now()}`
		await page.getByRole("textbox", { name: "Seksjonsnavn" }).fill(sectionName)
		await page.getByRole("button", { name: "Opprett seksjon" }).click()
		await expect(page.getByRole("heading", { name: sectionName })).toBeVisible()

		const teamName = `Testteam ${Date.now()}`
		const sectionCard = page.locator(".admin-card", { has: page.getByRole("heading", { name: sectionName }) })
		await sectionCard.getByRole("textbox", { name: "Teamnavn" }).fill(teamName)
		await sectionCard.getByRole("button", { name: "Legg til" }).click()

		await expect(page.getByText(`Team «${teamName}» opprettet.`)).toBeVisible()
		await expect(page.getByRole("cell", { name: teamName })).toBeVisible()
	})

	test("can delete a team", async ({ page }) => {
		const sectionName = `Seksjon-slett-team ${Date.now()}`
		await page.getByRole("textbox", { name: "Seksjonsnavn" }).fill(sectionName)
		await page.getByRole("button", { name: "Opprett seksjon" }).click()
		await expect(page.getByRole("heading", { name: sectionName })).toBeVisible()

		const teamName = `Team-slett ${Date.now()}`
		const sectionCard = page.locator(".admin-card", { has: page.getByRole("heading", { name: sectionName }) })
		await sectionCard.getByRole("textbox", { name: "Teamnavn" }).fill(teamName)
		await sectionCard.getByRole("button", { name: "Legg til" }).click()
		await expect(sectionCard.getByRole("cell", { name: teamName })).toBeVisible()

		// Click the Slett button in the team row within this section
		const teamRow = sectionCard.locator("tr", { hasText: teamName })
		await teamRow.getByRole("button", { name: "Slett" }).click()
		await page.getByRole("dialog").getByRole("button", { name: "Slett" }).click()

		await expect(page.getByText("Team slettet.")).toBeVisible()
	})

	test("can delete a section", async ({ page }) => {
		const sectionName = `Seksjon-slett ${Date.now()}`
		await page.getByRole("textbox", { name: "Seksjonsnavn" }).fill(sectionName)
		await page.getByRole("button", { name: "Opprett seksjon" }).click()
		await expect(page.getByRole("heading", { name: sectionName })).toBeVisible()

		const sectionCard = page.locator(".admin-card", { has: page.getByRole("heading", { name: sectionName }) })
		await sectionCard.getByRole("button", { name: "Slett" }).click()
		await page.getByRole("dialog").getByRole("button", { name: "Slett" }).click()

		await expect(page.getByText("Seksjon slettet.")).toBeVisible()
		await expect(page.getByRole("heading", { name: sectionName })).not.toBeVisible()
	})
})
