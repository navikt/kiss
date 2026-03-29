import { expect, test } from "@playwright/test"

const pages = [
	{ path: "/", name: "Dashboard" },
	{ path: "/kontrollrammeverk", name: "Kontrollrammeverk" },
	{ path: "/kontrollrammeverk/st", name: "Domene-detalj" },
	{ path: "/kontrollrammeverk/st/K-ST.01", name: "Kontroll-detalj" },
	{ path: "/applikasjoner", name: "Applikasjoner" },
	{ path: "/seksjoner", name: "Seksjoner" },
	{ path: "/seksjoner/utvikling", name: "Seksjon-dashboard" },
	{ path: "/seksjoner/utvikling/team/team-alfa", name: "Team-dashboard" },
	{ path: "/nais-overvaking", name: "Nais-overvaking" },
	{ path: "/rapporter", name: "Rapporter" },
	{ path: "/rapporter/generer", name: "Generer-rapport" },
	{ path: "/admin", name: "Admin" },
	{ path: "/import", name: "Import" },
]

for (const { path, name } of pages) {
	test(`${name} has no horizontal overflow`, async ({ page }) => {
		await page.goto(path)
		const noOverflow = await page.evaluate(
			() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
		)
		expect(noOverflow).toBe(true)
	})

	test(`${name} shows heading`, async ({ page }) => {
		await page.goto(path)
		const heading = page.locator("h2").first()
		await expect(heading).toBeVisible()
	})

	test(`${name} shows navigation`, async ({ page }) => {
		await page.goto(path)
		const nav = page.locator("nav")
		await expect(nav).toBeVisible()
	})
}
