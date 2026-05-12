import { PersonIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	Radio,
	RadioGroup,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getUserLandingPage, getUserRoles, setUserLandingPage } from "~/db/queries/users.server"
import type { LandingPage } from "~/db/schema/organization"
import { landingPageEnum, landingPageLabels, userRoleLabels } from "~/db/schema/organization"
import { getAuthenticatedUser } from "~/lib/auth.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) throw redirect("/dashboard")

	const [roles, landingPage] = await Promise.all([getUserRoles(user.navIdent), getUserLandingPage(user.navIdent)])

	return data({
		navIdent: user.navIdent,
		name: user.name,
		email: user.email ?? null,
		roles: roles.map((r) => ({
			id: r.id,
			role: r.role,
			roleLabel: userRoleLabels[r.role] ?? r.role,
			sectionName: r.sectionName,
			devTeamName: r.devTeamName,
		})),
		landingPage,
	})
}

export async function action({ request }: ActionFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) throw redirect("/dashboard")

	const formData = await request.formData()
	const intent = formData.get("intent") as string

	if (intent === "save-landing-page") {
		const landingPage = formData.get("landingPage") as string
		if (landingPageEnum.includes(landingPage as LandingPage)) {
			await setUserLandingPage(user.navIdent, landingPage as LandingPage)
		}
	}

	return data({ ok: true })
}

export default function ProfilePage() {
	const { navIdent, name, email, roles, landingPage } = useLoaderData<typeof loader>()

	return (
		<VStack gap="space-8">
			<HStack gap="space-4" align="center">
				<PersonIcon aria-hidden fontSize="2rem" />
				<Heading size="xlarge" level="2">
					Min profil
				</Heading>
			</HStack>

			{/* User info */}
			<Box padding="space-6" borderRadius="8" background="sunken">
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Brukerinformasjon
					</Heading>
					<HStack gap="space-16">
						<VStack gap="space-2">
							<Detail textColor="subtle">Navn</Detail>
							<BodyShort weight="semibold">{name}</BodyShort>
						</VStack>
						<VStack gap="space-2">
							<Detail textColor="subtle">NAV-ident</Detail>
							<BodyShort>{navIdent}</BodyShort>
						</VStack>
						{email && (
							<VStack gap="space-2">
								<Detail textColor="subtle">E-post</Detail>
								<BodyShort>{email}</BodyShort>
							</VStack>
						)}
					</HStack>
				</VStack>
			</Box>

			{/* Memberships (read-only) */}
			<Box padding="space-6" borderRadius="8" background="sunken">
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Mine tilknytninger
					</Heading>

					{roles.length > 0 ? (
						/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */
						<section className="table-scroll" tabIndex={0} aria-label="Tilknytninger">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell>Rolle</Table.HeaderCell>
										<Table.HeaderCell>Seksjon</Table.HeaderCell>
										<Table.HeaderCell>Team</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{roles.map((r) => (
										<Table.Row key={r.id}>
											<Table.DataCell>
												<Tag size="small" variant="info">
													{r.roleLabel}
												</Tag>
											</Table.DataCell>
											<Table.DataCell>{r.sectionName ?? "—"}</Table.DataCell>
											<Table.DataCell>{r.devTeamName ?? "—"}</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					) : (
						<BodyShort textColor="subtle">Du er ikke tilknyttet noen seksjon eller team.</BodyShort>
					)}
				</VStack>
			</Box>

			{/* Landing page preference */}
			<Box padding="space-6" borderRadius="8" background="sunken">
				<Form method="post">
					<input type="hidden" name="intent" value="save-landing-page" />
					<VStack gap="space-4">
						<Heading size="medium" level="3">
							Landingsside
						</Heading>
						<BodyShort>Velg hvilken side du vil se når du åpner KISS.</BodyShort>
						<RadioGroup legend="Landingsside" hideLegend defaultValue={landingPage} name="landingPage">
							{landingPageEnum.map((lp) => (
								<Radio key={lp} value={lp}>
									{landingPageLabels[lp]}
								</Radio>
							))}
						</RadioGroup>
						<HStack>
							<Button type="submit" size="small">
								Lagre
							</Button>
						</HStack>
					</VStack>
				</Form>
			</Box>
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
