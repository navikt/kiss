import { MoonIcon, SunIcon } from "@navikt/aksel-icons"
import { Button } from "@navikt/ds-react"
import { Form, useRouteLoaderData } from "react-router"
import type { loader as rootLoader } from "../root"

export function ThemeToggle() {
	const rootData = useRouteLoaderData<typeof rootLoader>("root")
	const theme = rootData?.theme ?? "light"
	const nextTheme = theme === "light" ? "dark" : "light"

	return (
		<Form method="post" action="/api/theme">
			<input type="hidden" name="theme" value={nextTheme} />
			<Button
				type="submit"
				variant="tertiary-neutral"
				size="small"
				icon={theme === "dark" ? <SunIcon aria-hidden /> : <MoonIcon aria-hidden />}
				aria-label={theme === "dark" ? "Bytt til lyst tema" : "Bytt til mørkt tema"}
			/>
		</Form>
	)
}
