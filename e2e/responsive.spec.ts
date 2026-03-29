import { expect, test } from "@playwright/test"

const pages = [
	{ path: "/", name: "Dashboard" },
	{ path: "/kontrollrammeverk", name: "Kontrollrammeverk" },
	{ path: "/applikasjoner", name: "Applikasjoner" },
	{ path: "/seksjoner", name: "Seksjoner" },
	{ path: "/nais-overvaking", name: "Nais-overvaking" },
	{ path: "/rapporter", name: "Rapporter" },
	{ path: "/admin", name: "Admin" },
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
