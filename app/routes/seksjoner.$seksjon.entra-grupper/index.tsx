import { BodyShort, CopyButton, Detail, Heading, HStack, Select, Table, Tag, VStack } from "@navikt/ds-react"
import { useState } from "react"
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router"
import { data, Link, useFetcher, useLoaderData, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { getSectionGroups, upsertGroupClassification } from "~/db/queries/nais.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import {
	type GroupAccessClassification,
	type GroupCriticality,
	groupAccessClassificationLabels,
	groupCriticalityLabels,
} from "~/db/schema/applications"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { canManageSection } from "~/lib/authorization.server"
import { resolveGroupNames } from "~/lib/graph.server"

const criticalityTagVariant: Record<string, "success" | "warning" | "error" | "neutral"> = {
	low: "success",
	medium: "neutral",
	high: "warning",
	very_high: "error",
}

const classificationTagVariant: Record<string, "info" | "neutral" | "success" | "warning"> = {
	mine_tilganger: "info",
	identrutina: "neutral",
	nais_console: "success",
	annet: "warning",
}

export async function loader({ request, params }: LoaderFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	const groups = await getSectionGroups(section.id)

	const groupIds = groups.map((g) => g.groupId)
	const groupNames = groupIds.length > 0 ? await resolveGroupNames(groupIds) : {}

	const notAssessedCount = groups.filter((g) => !g.criticality).length
	const notClassifiedCount = groups.filter((g) => !g.classification).length
	const canEdit = user ? canManageSection(user, section.id) : false

	return data({ section, seksjon, groups, groupNames, notAssessedCount, notClassifiedCount, canEdit })
}

export async function action({ request, params }: ActionFunctionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const user = await getAuthenticatedUser(request)
	const authedUser = requireUser(user)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	if (!canManageSection(authedUser, section.id)) {
		throw data({ message: "Ikke autorisert" }, { status: 403 })
	}

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "classify-group") {
		const groupId = formData.get("groupId") as string
		const classification = formData.get("classification") as GroupAccessClassification
		if (!groupId || !classification) {
			throw data({ message: "Mangler gruppeid eller klassifisering" }, { status: 400 })
		}
		const validClassifications: string[] = ["mine_tilganger", "identrutina", "nais_console", "annet"]
		if (!validClassifications.includes(classification)) {
			throw data({ message: `Ugyldig klassifisering: ${classification}` }, { status: 400 })
		}
		await upsertGroupClassification(groupId, classification, authedUser.navIdent)
		return data({ ok: true })
	}

	throw data({ message: `Ukjent handling: ${intent}` }, { status: 400 })
}

function ClassificationSelect({
	groupId,
	currentValue,
	canEdit,
}: {
	groupId: string
	currentValue: GroupAccessClassification | null
	canEdit: boolean
}) {
	const fetcher = useFetcher()
	const [value, setValue] = useState(currentValue ?? "")

	if (!canEdit) {
		if (!currentValue) {
			return (
				<BodyShort size="small" textColor="subtle">
					Ikke klassifisert
				</BodyShort>
			)
		}
		return (
			<Tag variant={classificationTagVariant[currentValue] ?? "neutral"} size="xsmall">
				{groupAccessClassificationLabels[currentValue]}
			</Tag>
		)
	}

	return (
		<fetcher.Form method="post">
			<input type="hidden" name="intent" value="classify-group" />
			<input type="hidden" name="groupId" value={groupId} />
			<Select
				label="Tilgangsmetode"
				hideLabel
				size="small"
				name="classification"
				value={value}
				onChange={(e) => {
					setValue(e.target.value)
					if (e.target.value) {
						fetcher.submit({ intent: "classify-group", groupId, classification: e.target.value }, { method: "post" })
					}
				}}
			>
				<option value="">– Velg –</option>
				{Object.entries(groupAccessClassificationLabels).map(([key, label]) => (
					<option key={key} value={key}>
						{label}
					</option>
				))}
			</Select>
		</fetcher.Form>
	)
}

type FilterValue = "alle" | "ikke_klassifisert" | GroupAccessClassification

export default function SeksjonEntraGrupper() {
	const { section, seksjon, groups, groupNames, notAssessedCount, notClassifiedCount, canEdit } =
		useLoaderData<typeof loader>()
	const [searchParams, setSearchParams] = useSearchParams()
	const filter = (searchParams.get("filter") as FilterValue) ?? "alle"

	const filteredGroups = groups.filter((g) => {
		if (filter === "alle") return true
		if (filter === "ikke_klassifisert") return !g.classification
		return g.classification === filter
	})

	return (
		<VStack gap="space-6">
			<VStack gap="space-2">
				<Heading size="large">Entra ID-grupper — {section.name}</Heading>
				<BodyShort textColor="subtle">
					Oversikt over alle Entra ID-grupper i bruk av applikasjoner i seksjonen.
					{notAssessedCount > 0 && ` ${notAssessedCount} av ${groups.length} mangler kritikalitetsvurdering.`}
					{notClassifiedCount > 0 && ` ${notClassifiedCount} av ${groups.length} mangler tilgangsklassifisering.`}
				</BodyShort>
			</VStack>

			<HStack gap="space-4" align="end">
				<Select
					label="Filtrer etter tilgangsmetode"
					size="small"
					value={filter}
					onChange={(e) => {
						const val = e.target.value
						if (val === "alle") {
							setSearchParams({})
						} else {
							setSearchParams({ filter: val })
						}
					}}
				>
					<option value="alle">Alle ({groups.length})</option>
					<option value="ikke_klassifisert">Ikke klassifisert ({notClassifiedCount})</option>
					{Object.entries(groupAccessClassificationLabels).map(([key, label]) => {
						const count = groups.filter((g) => g.classification === key).length
						return (
							<option key={key} value={key}>
								{label} ({count})
							</option>
						)
					})}
				</Select>
			</HStack>

			{groups.length === 0 ? (
				<BodyShort textColor="subtle">Ingen Entra ID-grupper funnet for denne seksjonen.</BodyShort>
			) : filteredGroups.length === 0 ? (
				<BodyShort textColor="subtle">Ingen grupper matcher filteret.</BodyShort>
			) : (
				<div className="table-scroll">
					<Table size="small" zebraStripes>
						<Table.Header>
							<Table.Row>
								<Table.HeaderCell scope="col">Gruppe</Table.HeaderCell>
								<Table.HeaderCell scope="col">Applikasjoner</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
								<Table.HeaderCell scope="col">Kritikalitet</Table.HeaderCell>
								<Table.HeaderCell scope="col">Tilgangsmetode</Table.HeaderCell>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{filteredGroups.map((g) => {
								const displayName = groupNames[g.groupId] ?? null
								const sources = [...new Set(g.applications.map((a) => a.source))]

								return (
									<Table.Row key={g.groupId}>
										<Table.DataCell>
											<VStack gap="space-1">
												<BodyShort size="small" weight="semibold">
													{displayName ?? "Ukjent gruppe"}
												</BodyShort>
												<HStack gap="space-1" align="center">
													<Detail textColor="subtle" style={{ fontFamily: "monospace" }}>
														{g.groupId}
													</Detail>
													<CopyButton copyText={g.groupId} size="xsmall" />
												</HStack>
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{g.applications.map((app) => (
													<Link
														key={app.applicationId}
														to={`/seksjoner/${seksjon}/applikasjoner/${app.applicationId}/detaljer`}
														style={{ fontSize: "var(--ax-font-size-small)" }}
													>
														{app.applicationName}
													</Link>
												))}
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											<HStack gap="space-1" wrap>
												{sources.includes("nais") && (
													<Tag variant="info" size="xsmall">
														Nais
													</Tag>
												)}
												{sources.includes("manual") && (
													<Tag variant="neutral" size="xsmall">
														Manuell
													</Tag>
												)}
											</HStack>
										</Table.DataCell>
										<Table.DataCell>
											{g.criticality ? (
												<Tag variant={criticalityTagVariant[g.criticality] ?? "neutral"} size="xsmall">
													{groupCriticalityLabels[g.criticality as GroupCriticality] ?? g.criticality}
												</Tag>
											) : (
												<BodyShort size="small" textColor="subtle">
													Ikke vurdert
												</BodyShort>
											)}
										</Table.DataCell>
										<Table.DataCell>
											<ClassificationSelect groupId={g.groupId} currentValue={g.classification} canEdit={canEdit} />
										</Table.DataCell>
									</Table.Row>
								)
							})}
						</Table.Body>
					</Table>
				</div>
			)}
		</VStack>
	)
}

export { RouteErrorBoundary as ErrorBoundary }
