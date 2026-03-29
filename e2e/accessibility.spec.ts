import AxeBuilder from "@axe-core/playwright"
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
	{ path: "/nais-overvaking", name: "Nais-overvåking" },
	{ path: "/rapporter", name: "Rapporter" },
	{ path: "/rapporter/generer", name: "Generer-rapport" },
	{ path: "/admin", name: "Admin" },
	{ path: "/import", name: "Import" },
]

for (const { path, name } of pages) {
	test(`${name} has no WCAG 2.1 AA violations`, async ({ page }) => {
		await page.goto(path)

		const results = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
			.analyze()

		const violations = results.violations.map((v) => ({
			id: v.id,
			impact: v.impact,
			description: v.description,
			nodes: v.nodes.length,
			targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
		}))

		expect(violations, `WCAG violations on ${name}:\n${JSON.stringify(violations, null, 2)}`).toEqual([])
	})
}

test("Navigation bar has sufficient color contrast", async ({ page }) => {
	await page.goto("/")

	const results = await new AxeBuilder({ page })
		.include("nav.app-nav")
		.withTags(["wcag2aa"])
		.analyze()

	const contrastViolations = results.violations.filter((v) => v.id === "color-contrast")
	expect(contrastViolations, "Nav should have no contrast violations").toEqual([])
})
