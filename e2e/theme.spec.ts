import { expect, test } from "@playwright/test"

test.describe("Theme toggle", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/")
	})

	test("theme toggle button exists", async ({ page }) => {
		const toggleButton = page.getByRole("button", {
			name: /bytt til (mørkt|lyst) tema/i,
		})
		await expect(toggleButton).toBeVisible()
	})

	test("clicking toggle changes data-theme and sets cookie", async ({
		page,
	}) => {
		const container = page.locator("[data-theme]")
		await expect(container).toHaveAttribute("data-theme", "light")

		const toggleButton = page.getByRole("button", {
			name: "Bytt til mørkt tema",
		})
		await toggleButton.click()

		await expect(container).toHaveAttribute("data-theme", "dark")

		const cookies = await page.context().cookies()
		const themeCookie = cookies.find((c) => c.name === "kiss-theme")
		expect(themeCookie).toBeDefined()
		expect(themeCookie?.value).toBe("dark")

		const toggleBack = page.getByRole("button", {
			name: "Bytt til lyst tema",
		})
		await toggleBack.click()

		await expect(container).toHaveAttribute("data-theme", "light")
	})
})
