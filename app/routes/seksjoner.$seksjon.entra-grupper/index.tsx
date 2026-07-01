import {
	BodyShort,
	CopyButton,
	Detail,
	Heading,
	HStack,
	Select,
	type SortState,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useMemo, useState } from "react"
import { data, Link, useFetcher, useLoaderData, useSearchParams } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { deleteGroupClassification, getSectionGroups, upsertGroupClassification } from "~/db/queries/nais.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import {
	type GroupAccessClassification,
	type GroupCriticality,
	groupAccessClassificationLabels,
	groupCriticalityLabels,
} from "~/db/schema/applications"
import { getAuthenticatedUser, requireAuthenticatedUser } from "~/lib/auth.server"
import { canManageSection } from "~/lib/authorization.server"
import { resolveGroupNames } from "~/lib/graph.server"
import type { Route } from "./+types/index"

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

export async function loader({ request, params }: Route.LoaderArgs) {
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

export async function action({ request, params }: Route.ActionArgs) {
	const { seksjon } = params
	if (!seksjon) throw data({ message: "Mangler seksjonsparameter" }, { status: 400 })

	const authedUser = await requireAuthenticatedUser(request)

	const section = await getSectionBySlug(seksjon)
	if (!section) throw data({ message: `Fant ikke seksjon: ${seksjon}` }, { status: 404 })

	if (!canManageSection(authedUser, section.id)) {
		throw data({ message: "Ikke autorisert" }, { status: 403 })
	}

	const formData = await request.formData()
	const intent = formData.get("intent")

	if (intent === "classify-group") {
		const groupId = formData.get("groupId") as string
		const classification = formData.get("classification") as string
		if (!groupId) {
			throw data({ message: "Mangler gruppeid" }, { status: 400 })
		}
		if (!classification) {
			await deleteGroupClassification(groupId, authedUser.navIdent)
			return data({ ok: true })
		}
		const validClassifications: string[] = ["mine_tilganger", "identrutina", "nais_console", "annet"]
		if (!validClassifications.includes(classification)) {
			throw data({ message: `Ugyldig klassifisering: ${classification}` }, { status: 400 })
		}
		await upsertGroupClassification(groupId, classification as GroupAccessClassification, authedUser.navIdent)
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
					fetcher.submit({ intent: "classify-group", groupId, classification: e.target.value }, { method: "post" })
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
type SortKey = "gruppe" | "kilde" | "kritikalitet" | "tilgangsmetode"

const criticalityOrder: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 }
const classificationOrder: Record<string, number> = { mine_tilganger: 0, identrutina: 1, nais_console: 2, annet: 3 }

export default function SeksjonEntraGrupper() {
	const { section, seksjon, groups, groupNames, notAssessedCount, notClassifiedCount, canEdit } =
		useLoaderData<typeof loader>()
	const [searchParams, setSearchParams] = useSearchParams()
	const filter = (searchParams.get("filter") as FilterValue) ?? "alle"
	const [sort, setSort] = useState<SortState>({ orderBy: "gruppe", direction: "ascending" })

	const filteredGroups = groups.filter((g) => {
		if (filter === "alle") return true
		if (filter === "ikke_klassifisert") return !g.classification
		return g.classification === filter
	})

	const sorted = useMemo(() => {
		const dir = sort.direction === "ascending" ? 1 : -1
		return [...filteredGroups].sort((a, b) => {
			switch (sort.orderBy as SortKey) {
				case "gruppe": {
					const nameA = (groupNames[a.groupId] ?? "").toLowerCase()
					const nameB = (groupNames[b.groupId] ?? "").toLowerCase()
					return nameA.localeCompare(nameB, "nb") * dir
				}
				case "kilde": {
					const srcA = [...new Set(a.applications.map((app) => app.source))].sort().join(",")
					const srcB = [...new Set(b.applications.map((app) => app.source))].sort().join(",")
					return srcA.localeCompare(srcB, "nb") * dir
				}
				case "kritikalitet": {
					const ordA = a.criticality ? (criticalityOrder[a.criticality] ?? 99) : 99
					const ordB = b.criticality ? (criticalityOrder[b.criticality] ?? 99) : 99
					return (ordA - ordB) * dir
				}
				case "tilgangsmetode": {
					const ordA = a.classification ? (classificationOrder[a.classification] ?? 99) : 99
					const ordB = b.classification ? (classificationOrder[b.classification] ?? 99) : 99
					return (ordA - ordB) * dir
				}
				default:
					return 0
			}
		})
	}, [filteredGroups, sort, groupNames])

	const handleSort = (sortKey: string) => {
		setSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

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
			) : sorted.length === 0 ? (
				<BodyShort textColor="subtle">Ingen grupper matcher filteret.</BodyShort>
			) : (
				<div className="table-scroll">
					<Table size="small" zebraStripes sort={sort} onSortChange={handleSort}>
						<Table.Header>
							<Table.Row>
								<Table.ColumnHeader scope="col" sortKey="gruppe" sortable>
									Gruppe
								</Table.ColumnHeader>
								<Table.HeaderCell scope="col">Applikasjoner</Table.HeaderCell>
								<Table.ColumnHeader scope="col" sortKey="kilde" sortable>
									Kilde
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="kritikalitet" sortable>
									Kritikalitet
								</Table.ColumnHeader>
								<Table.ColumnHeader scope="col" sortKey="tilgangsmetode" sortable>
									Tilgangsmetode
								</Table.ColumnHeader>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{sorted.map((g) => {
								const displayName = groupNames[g.groupId] ?? null
								const sources = [...new Set(g.applications.map((a) => a.source))]

								return (
									<Table.Row key={g.groupId}>
										<Table.DataCell>
											<VStack gap="space-1">
												<HStack gap="space-1" align="center">
													<BodyShort size="small" weight="semibold">
														{displayName ?? "Ukjent gruppe"}
													</BodyShort>
													{displayName && <CopyButton copyText={displayName} size="xsmall" />}
												</HStack>
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
