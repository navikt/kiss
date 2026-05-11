import { XMarkOctagonIcon } from "@navikt/aksel-icons"
import type { FileObject } from "@navikt/ds-react"
import {
	Alert,
	BodyLong,
	BodyShort,
	Box,
	Button,
	Detail,
	FileUpload,
	Heading,
	HStack,
	Search,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useCallback, useState } from "react"
import { Link, type SubmitFunction } from "react-router"
import { type AccessPolicyRule, getStatusKey, parseTrafficCsv, statusSortOrder, type TrafficRow } from "../shared"

export function AuthorizedAppsPanel({
	accessPolicyRules,
	knownApps,
	acknowledgments,
	submit,
	setAckTarget,
	setAckComment,
	ackModalRef,
}: {
	accessPolicyRules: AccessPolicyRule[]
	knownApps: Record<string, { status: string; appId?: string }>
	acknowledgments: Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }>
	submit: SubmitFunction
	setAckTarget: (target: string | null) => void
	setAckComment: (comment: string) => void
	ackModalRef: React.RefObject<HTMLDialogElement | null>
}) {
	const [searchQuery, setSearchQuery] = useState("")
	const [sort, setSort] = useState<{ orderBy: string; direction: "ascending" | "descending" } | undefined>()
	const [trafficData, setTrafficData] = useState<TrafficRow[] | null>(null)
	const [fileName, setFileName] = useState<string | null>(null)

	const handleFileSelect = useCallback((newFiles: FileObject[]) => {
		const accepted = newFiles.find((f) => !f.error)
		if (!accepted) return
		const file = accepted.file
		const reader = new FileReader()
		reader.onload = (e) => {
			const text = e.target?.result as string
			setTrafficData(parseTrafficCsv(text))
			setFileName(file.name)
		}
		reader.readAsText(file)
	}, [])

	const handleSort = (sortKey: string) =>
		setSort((prev) =>
			prev?.orderBy === sortKey && prev.direction === "ascending"
				? { orderBy: sortKey, direction: "descending" }
				: { orderBy: sortKey, direction: "ascending" },
		)

	const inboundRules = accessPolicyRules.filter((r) => r.direction === "inbound")
	const trafficByApp = trafficData ? new Map(trafficData.map((t) => [t.appName, t])) : null

	const filteredRules = inboundRules.filter((rule) => {
		if (!searchQuery) return true
		const q = searchQuery.toLowerCase()
		return (
			rule.ruleApplication.toLowerCase().includes(q) ||
			(rule.ruleNamespace?.toLowerCase().includes(q) ?? false) ||
			(rule.ruleCluster?.toLowerCase().includes(q) ?? false)
		)
	})

	const sortedRules = sort
		? [...filteredRules].sort((a, b) => {
				const dir = sort.direction === "ascending" ? 1 : -1
				switch (sort.orderBy) {
					case "appName":
						return dir * a.ruleApplication.localeCompare(b.ruleApplication, "nb")
					case "namespace":
						return dir * (a.ruleNamespace ?? "").localeCompare(b.ruleNamespace ?? "", "nb")
					case "cluster":
						return dir * (a.ruleCluster ?? "").localeCompare(b.ruleCluster ?? "", "nb")
					case "status": {
						const statusA =
							statusSortOrder[getStatusKey(knownApps[a.ruleApplication], acknowledgments[a.ruleApplication])] ?? 99
						const statusB =
							statusSortOrder[getStatusKey(knownApps[b.ruleApplication], acknowledgments[b.ruleApplication])] ?? 99
						return dir * (statusA - statusB)
					}
					case "callCount": {
						const countA = trafficByApp?.get(a.ruleApplication)?.count ?? -1
						const countB = trafficByApp?.get(b.ruleApplication)?.count ?? -1
						return dir * (countA - countB)
					}
					case "trafficStatus": {
						const hasA = trafficByApp?.has(a.ruleApplication) ? 0 : 1
						const hasB = trafficByApp?.has(b.ruleApplication) ? 0 : 1
						return dir * (hasA - hasB)
					}
					default:
						return 0
				}
			})
		: filteredRules

	const policyAppNames = new Set(inboundRules.map((r) => r.ruleApplication))
	const unknownCallers = trafficData?.filter((t) => !policyAppNames.has(t.appName)) ?? []
	const noTrafficCount = trafficByApp ? inboundRules.filter((r) => !trafficByApp.has(r.ruleApplication)).length : 0

	return (
		<VStack gap="space-4">
			<Alert variant="info" size="small">
				Autoriserte applikasjoner er de som har nettverkstilgang til å kalle denne applikasjonen, og som kan utstede
				tokens via TokenX eller Entra ID. Oversikten hentes automatisk fra <code>spec.accessPolicy.inbound.rules</code>{" "}
				i Nais-manifestet.
			</Alert>

			{inboundRules.length === 0 ? (
				<BodyLong>
					Ingen autoriserte applikasjoner funnet. Applikasjonen har enten ikke definert{" "}
					<code>accessPolicy.inbound.rules</code> i sitt Nais-manifest, eller den har ikke blitt synkronisert ennå.
				</BodyLong>
			) : (
				<VStack gap="space-2">
					<Heading size="xsmall" level="4">
						Innkommende tilgang ({inboundRules.length} {inboundRules.length === 1 ? "applikasjon" : "applikasjoner"})
					</Heading>
					<BodyShort size="small" textColor="subtle">
						Disse applikasjonene har tillatelse til å kalle dette API-et over nettverket.
					</BodyShort>
					<HStack gap="space-4" align="end">
						<div style={{ flex: 1 }}>
							<Search
								label="Søk i autoriserte applikasjoner"
								variant="simple"
								size="small"
								value={searchQuery}
								onChange={setSearchQuery}
								onClear={() => setSearchQuery("")}
								placeholder="Filtrer på applikasjon, namespace eller klynge"
							/>
						</div>
						{trafficData && (
							<HStack gap="space-2" align="center">
								<Detail textColor="subtle">{fileName}</Detail>
								<Button
									variant="tertiary"
									size="xsmall"
									onClick={() => {
										setTrafficData(null)
										setFileName(null)
									}}
								>
									Fjern
								</Button>
							</HStack>
						)}
					</HStack>

					{!trafficData && (
						<FileUpload.Dropzone
							label="Dra og slipp CSV-fil med trafikkdata, eller klikk for å velge"
							description="Trafikkdata i CSV-format"
							accept=".csv"
							multiple={false}
							onSelect={handleFileSelect}
						/>
					)}

					{trafficData && noTrafficCount > 0 && (
						<Alert variant="warning" size="small">
							{noTrafficCount} av {inboundRules.length} autoriserte applikasjoner har ingen registrert trafikk i den
							opplastede perioden.
						</Alert>
					)}

					{filteredRules.length === 0 ? (
						<Box padding="space-6" borderRadius="8" background="sunken">
							<BodyShort>Ingen treff for «{searchQuery}».</BodyShort>
						</Box>
					) : (
						// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table container needs keyboard focus
						<section className="table-scroll" tabIndex={0} aria-label="Autoriserte applikasjoner">
							<Table size="small" sort={sort} onSortChange={handleSort}>
								<Table.Header>
									<Table.Row>
										<Table.ColumnHeader sortKey="appName" sortable scope="col">
											Applikasjon
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="namespace" sortable scope="col">
											Namespace
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="cluster" sortable scope="col">
											Klynge
										</Table.ColumnHeader>
										<Table.ColumnHeader sortKey="status" sortable scope="col">
											Status
										</Table.ColumnHeader>
										{trafficData && (
											<>
												<Table.ColumnHeader sortKey="callCount" sortable scope="col" align="right">
													Antall kall
												</Table.ColumnHeader>
												<Table.ColumnHeader sortKey="trafficStatus" sortable scope="col">
													Trafikk
												</Table.ColumnHeader>
											</>
										)}
										<Table.HeaderCell scope="col">Handling</Table.HeaderCell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{sortedRules.map((rule) => {
										const resolution = knownApps[rule.ruleApplication]
										const ack = acknowledgments[rule.ruleApplication]
										const isUnknown = !resolution || resolution.status === "unknown"
										const traffic = trafficByApp?.get(rule.ruleApplication)
										return (
											<Table.Row key={rule.id}>
												<Table.DataCell>
													{resolution?.status === "monitored" ? (
														<Link to={`/applikasjoner/${resolution.appId}/detaljer`}>
															<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleApplication}</code>
														</Link>
													) : (
														<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleApplication}</code>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{rule.ruleNamespace ? (
														<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleNamespace}</code>
													) : (
														<BodyShort size="small" textColor="subtle">
															Samme
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{rule.ruleCluster ? (
														<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{rule.ruleCluster}</code>
													) : (
														<BodyShort size="small" textColor="subtle">
															Samme
														</BodyShort>
													)}
												</Table.DataCell>
												<Table.DataCell>
													{resolution?.status === "monitored" ? (
														<Tag variant="success" size="xsmall">
															Overvåket
														</Tag>
													) : resolution?.status === "discovered" ? (
														<Tag variant="info" size="xsmall">
															Nais
														</Tag>
													) : ack ? (
														<VStack gap="space-1">
															<HStack gap="space-2" align="center">
																<Tag variant="neutral" size="xsmall">
																	Kvittert
																</Tag>
															</HStack>
															<BodyShort size="small" textColor="subtle">
																{ack.comment}
															</BodyShort>
															<Detail textColor="subtle">
																{ack.acknowledgedBy}, {new Date(ack.acknowledgedAt).toLocaleDateString("nb-NO")}
															</Detail>
														</VStack>
													) : (
														<HStack gap="space-1" align="center">
															<XMarkOctagonIcon
																aria-hidden
																fontSize="1rem"
																style={{ color: "var(--ax-text-warning)" }}
															/>
															<Tag variant="warning" size="xsmall">
																Ukjent
															</Tag>
														</HStack>
													)}
												</Table.DataCell>
												{trafficByApp && (
													<>
														<Table.DataCell align="right">
															{traffic ? traffic.count.toLocaleString("nb-NO") : "–"}
														</Table.DataCell>
														<Table.DataCell>
															{traffic ? (
																<Tag variant="success" size="xsmall">
																	Aktiv
																</Tag>
															) : (
																<Tag variant="warning" size="xsmall">
																	Ingen trafikk
																</Tag>
															)}
														</Table.DataCell>
													</>
												)}
												<Table.DataCell>
													{isUnknown &&
														(ack ? (
															<Button
																variant="tertiary-neutral"
																size="xsmall"
																onClick={() =>
																	submit(
																		{
																			intent: "revoke-acknowledgment",
																			ruleApplication: rule.ruleApplication,
																		},
																		{ method: "POST" },
																	)
																}
															>
																Trekk tilbake
															</Button>
														) : (
															<Button
																variant="tertiary"
																size="xsmall"
																onClick={() => {
																	setAckTarget(rule.ruleApplication)
																	setAckComment("")
																	ackModalRef.current?.showModal()
																}}
															>
																Kvitter ut
															</Button>
														))}
												</Table.DataCell>
											</Table.Row>
										)
									})}
								</Table.Body>
							</Table>
						</section>
					)}
					{searchQuery && filteredRules.length < inboundRules.length && (
						<BodyShort size="small" textColor="subtle">
							Viser {filteredRules.length} av {inboundRules.length} applikasjoner
						</BodyShort>
					)}
				</VStack>
			)}

			{unknownCallers.length > 0 && (
				<VStack gap="space-2">
					<Heading size="xsmall" level="4">
						Kallende applikasjoner uten autorisasjon ({unknownCallers.length})
					</Heading>
					<BodyShort size="small" textColor="subtle">
						Disse applikasjonene har trafikk i loggen, men er ikke blant de autoriserte applikasjonene.
					</BodyShort>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable table container needs keyboard focus */}
					<section className="table-scroll" tabIndex={0} aria-label="Kallende applikasjoner uten autorisasjon">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Applikasjon</Table.HeaderCell>
									<Table.HeaderCell scope="col">Namespace</Table.HeaderCell>
									<Table.HeaderCell scope="col">Klynge</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Antall kall
									</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{unknownCallers
									.sort((a, b) => b.count - a.count)
									.map((t) => (
										<Table.Row key={`${t.cluster}:${t.namespace}:${t.appName}`}>
											<Table.DataCell>
												<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{t.appName}</code>
											</Table.DataCell>
											<Table.DataCell>
												<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{t.namespace}</code>
											</Table.DataCell>
											<Table.DataCell>
												<code style={{ fontSize: "var(--ax-font-size-sm)" }}>{t.cluster}</code>
											</Table.DataCell>
											<Table.DataCell align="right">{t.count.toLocaleString("nb-NO")}</Table.DataCell>
										</Table.Row>
									))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}
