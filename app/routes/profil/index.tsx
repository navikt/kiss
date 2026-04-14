import { PersonIcon, PlusIcon, TrashIcon } from "@navikt/aksel-icons"
import {
	BodyShort,
	Box,
	Button,
	Detail,
	Heading,
	HStack,
	Radio,
	RadioGroup,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Form, redirect, useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSections } from "~/db/queries/sections.server"
import {
	assignRole,
	getAllDevTeams,
	getUserLandingPage,
	getUserRoles,
	removeRole,
	setUserLandingPage,
	upsertUser,
} from "~/db/queries/users.server"
import type { LandingPage } from "~/db/schema/organization"
import { landingPageEnum, landingPageLabels, userRoleLabels } from "~/db/schema/organization"
import { getAuthenticatedUser } from "~/lib/auth.server"

export async function loader({ request }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	if (!user) throw redirect("/dashboard")

	const [roles, landingPage, allSections, allTeams] = await Promise.all([
		getUserRoles(user.navIdent),
		getUserLandingPage(user.navIdent),
		getSections(),
		getAllDevTeams(),
	])

	return data({
		navIdent: user.navIdent,
		name: user.name,
		email: user.email ?? null,
		roles: roles.map((r) => ({
			id: r.id,
			role: r.role,
			roleLabel: userRoleLabels[r.role] ?? r.role,
			sectionId: r.sectionId,
			sectionName: r.sectionName,
			devTeamId: r.devTeamId,
			devTeamName: r.devTeamName,
		})),
		landingPage,
		sections: allSections.map((s) => ({ id: s.id, name: s.name })),
		teams: allTeams,
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
	} else if (intent === "add-membership") {
		const sectionId = formData.get("sectionId") as string
		const devTeamId = (formData.get("devTeamId") as string) || undefined
		if (sectionId) {
			await upsertUser(user.navIdent, user.name, user.email)
			await assignRole(user.navIdent, user.name, "developer", user.navIdent, sectionId, devTeamId)
		}
	} else if (intent === "remove-membership") {
		const roleId = formData.get("roleId") as string
		if (roleId) {
			// Verify the role belongs to the current user before removing
			const roles = await getUserRoles(user.navIdent)
			const ownsRole = roles.some((r) => r.id === roleId)
			if (ownsRole) {
				await removeRole(roleId)
			}
		}
	}

	return data({ ok: true })
}

export default function ProfilePage() {
	const { navIdent, name, email, roles, landingPage, sections, teams } = useLoaderData<typeof loader>()
	const [selectedSectionId, setSelectedSectionId] = useState("")

	const teamsForSection = teams.filter((t) => t.sectionId === selectedSectionId)

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

			{/* Memberships */}
			<Box padding="space-6" borderRadius="8" background="sunken">
				<VStack gap="space-4">
					<Heading size="medium" level="3">
						Mine tilknytninger
					</Heading>
					<BodyShort>Koble deg til en seksjon og eventuelt et team for å få tilgang til relevant innhold.</BodyShort>

					{roles.length > 0 && (
						/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table needs keyboard access */
						<section className="table-scroll" tabIndex={0} aria-label="Tilknytninger">
							<Table size="small">
								<Table.Header>
									<Table.Row>
										<Table.HeaderCell>Rolle</Table.HeaderCell>
										<Table.HeaderCell>Seksjon</Table.HeaderCell>
										<Table.HeaderCell>Team</Table.HeaderCell>
										<Table.HeaderCell style={{ width: "1%" }} />
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
											<Table.DataCell>
												<Form method="post">
													<input type="hidden" name="intent" value="remove-membership" />
													<input type="hidden" name="roleId" value={r.id} />
													<Button
														type="submit"
														variant="tertiary-neutral"
														size="small"
														icon={<TrashIcon aria-hidden />}
														title="Fjern tilknytning"
													/>
												</Form>
											</Table.DataCell>
										</Table.Row>
									))}
								</Table.Body>
							</Table>
						</section>
					)}

					{roles.length === 0 && (
						<BodyShort textColor="subtle">Du er ikke tilknyttet noen seksjon eller team ennå.</BodyShort>
					)}

					{/* Add membership form */}
					<Form method="post">
						<input type="hidden" name="intent" value="add-membership" />
						<VStack gap="space-4">
							<Heading size="small" level="4">
								Legg til tilknytning
							</Heading>
							<HStack gap="space-4" align="end" wrap>
								<Select
									label="Seksjon"
									name="sectionId"
									size="small"
									value={selectedSectionId}
									onChange={(e) => setSelectedSectionId(e.target.value)}
								>
									<option value="">Velg seksjon</option>
									{sections.map((s) => (
										<option key={s.id} value={s.id}>
											{s.name}
										</option>
									))}
								</Select>
								<Select label="Team (valgfritt)" name="devTeamId" size="small" disabled={!selectedSectionId}>
									<option value="">Ingen team</option>
									{teamsForSection.map((t) => (
										<option key={t.id} value={t.id}>
											{t.name}
										</option>
									))}
								</Select>
								<Button
									type="submit"
									size="small"
									variant="secondary"
									disabled={!selectedSectionId}
									icon={<PlusIcon aria-hidden />}
								>
									Legg til
								</Button>
							</HStack>
						</VStack>
					</Form>
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
