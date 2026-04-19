import {
	BodyShort,
	Checkbox,
	CheckboxGroup,
	Heading,
	HStack,
	Search,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { Link } from "react-router"
import { ComplianceStatusBadge } from "~/components/ComplianceStatus"
import type { ComplianceStatus } from "~/lib/compliance-status"
import {
	complianceLabels,
	complianceVariants,
	establishmentLabels,
	establishmentVariants,
	type RoutineCompliance,
	type RoutineEstablishment,
} from "~/lib/compliance-status"
import { ControlRow } from "../components/ControlRow"
import { createControlLink } from "../shared"

type Assessment = {
	controlUuid: string
	domainCode: string
	domainName: string | null
	controlId: string
	controlName: string
	technologyElementId: string | null
	technologyElementName: string | null
	effectiveStatus: string | null
	establishment: string
	routineCompliance: string
	applicationControlId: string | null
	comment: string | null
	commentUpdatedAt: string | null
	commentUpdatedBy: string | null
}

export function KontrollerTab({
	assessments,
	compliance,
	sectionSlug,
	appBasePath,
}: {
	assessments: Assessment[]
	compliance: { hasScreeningAnswers: boolean }
	sectionSlug: string | null
	appBasePath: string
}) {
	const [controlSort, setControlSort] = useState<{ orderBy: string; direction: "ascending" | "descending" }>({
		orderBy: "controlId",
		direction: "ascending",
	})
	const [controlStatusFilter, setControlStatusFilter] = useState<string[]>([])
	const [controlSearch, setControlSearch] = useState("")
	const [controlGroupBy, setControlGroupBy] = useState<string>("none")

	const statusLabel = (s: string | null): string => {
		if (!s) return "Ikke vurdert"
		const labels: Record<string, string> = {
			implemented: "Implementert",
			partially_implemented: "Delvis implementert",
			not_implemented: "Ikke implementert",
			not_relevant: "Ikke relevant",
		}
		return labels[s] ?? s
	}

	const relevantAssessments = assessments.filter((a) => a.effectiveStatus !== "not_relevant")
	const notRelevantAssessments = assessments.filter((a) => a.effectiveStatus === "not_relevant")

	const filteredAssessments = relevantAssessments.filter((a) => {
		if (controlStatusFilter.length > 0) {
			const effectiveLabel = a.effectiveStatus ?? "not_assessed"
			if (!controlStatusFilter.includes(effectiveLabel)) return false
		}
		if (controlSearch) {
			const q = controlSearch.toLowerCase()
			if (
				!a.controlId.toLowerCase().includes(q) &&
				!a.controlName.toLowerCase().includes(q) &&
				!(a.domainName ?? "").toLowerCase().includes(q) &&
				!(a.technologyElementName ?? "").toLowerCase().includes(q)
			)
				return false
		}
		return true
	})

	const sortedAssessments = [...filteredAssessments].sort((a, b) => {
		const dir = controlSort.direction === "ascending" ? 1 : -1
		const orderBy = controlSort.orderBy
		let aVal: string
		let bVal: string
		if (orderBy === "domainName") {
			aVal = a.domainName ?? ""
			bVal = b.domainName ?? ""
		} else if (orderBy === "controlId") {
			aVal = a.controlId
			bVal = b.controlId
		} else if (orderBy === "controlName") {
			aVal = a.controlName
			bVal = b.controlName
		} else if (orderBy === "technologyElementName") {
			aVal = a.technologyElementName ?? ""
			bVal = b.technologyElementName ?? ""
		} else if (orderBy === "status") {
			aVal = statusLabel(a.effectiveStatus)
			bVal = statusLabel(b.effectiveStatus)
		} else if (orderBy === "establishment") {
			aVal = a.establishment
			bVal = b.establishment
		} else if (orderBy === "routineCompliance") {
			aVal = a.routineCompliance
			bVal = b.routineCompliance
		} else {
			return 0
		}
		return aVal.localeCompare(bVal, "nb") * dir
	})

	const groupedAssessments: Array<{ groupLabel: string; items: typeof sortedAssessments }> = (() => {
		if (controlGroupBy === "none") return [{ groupLabel: "", items: sortedAssessments }]
		const groups = new Map<string, typeof sortedAssessments>()
		for (const a of sortedAssessments) {
			let key: string
			if (controlGroupBy === "domainName") key = a.domainName || "Uten domene"
			else if (controlGroupBy === "controlId") key = a.controlId
			else if (controlGroupBy === "controlName") key = a.controlName
			else if (controlGroupBy === "technologyElementName") key = a.technologyElementName || "Ingen"
			else if (controlGroupBy === "status") key = statusLabel(a.effectiveStatus)
			else if (controlGroupBy === "establishment")
				key = establishmentLabels[a.establishment as RoutineEstablishment] ?? a.establishment
			else if (controlGroupBy === "routineCompliance")
				key = complianceLabels[a.routineCompliance as RoutineCompliance] ?? a.routineCompliance
			else key = ""
			const list = groups.get(key) ?? []
			list.push(a)
			groups.set(key, list)
		}
		return [...groups.entries()]
			.sort(([a], [b]) => a.localeCompare(b, "nb"))
			.map(([groupLabel, items]) => ({ groupLabel, items }))
	})()

	const handleControlSort = (sortKey: string) => {
		setControlSort((prev) =>
			prev.orderBy === sortKey
				? { orderBy: sortKey, direction: prev.direction === "ascending" ? "descending" : "ascending" }
				: { orderBy: sortKey, direction: "ascending" },
		)
	}

	return (
		<VStack gap="space-6">
			<HStack gap="space-4" wrap align="end">
				<div style={{ flex: "1 1 200px", maxWidth: "300px" }}>
					<Search
						label="Søk i kontroller"
						size="small"
						value={controlSearch}
						onChange={setControlSearch}
						onClear={() => setControlSearch("")}
					/>
				</div>
				<div style={{ minWidth: "180px" }}>
					<Select
						label="Grupper etter"
						size="small"
						value={controlGroupBy}
						onChange={(e) => setControlGroupBy(e.target.value)}
					>
						<option value="none">Ingen gruppering</option>
						<option value="domainName">Domene</option>
						<option value="controlId">Kontroll-ID</option>
						<option value="controlName">Navn</option>
						<option value="technologyElementName">Teknologielement</option>
						<option value="status">Status</option>
						<option value="establishment">Rutineetablering</option>
						<option value="routineCompliance">Etterlevelse</option>
					</Select>
				</div>
			</HStack>

			<CheckboxGroup
				legend="Filtrer på status"
				size="small"
				value={controlStatusFilter}
				onChange={setControlStatusFilter}
				hideLegend
			>
				<HStack gap="space-4" wrap>
					<Checkbox value="implemented">Implementert</Checkbox>
					<Checkbox value="partially_implemented">Delvis</Checkbox>
					<Checkbox value="not_implemented">Ikke impl.</Checkbox>
					<Checkbox value="not_assessed">Ikke vurdert</Checkbox>
				</HStack>
			</CheckboxGroup>

			<BodyShort size="small" textColor="subtle">
				Viser {filteredAssessments.length} av {relevantAssessments.length} kontroller
				{compliance.hasScreeningAnswers ? " (basert på screening-svar)" : " (alle kontroller — ingen screening-svar)"}
			</BodyShort>

			<HStack gap="space-8" wrap>
				<Tag variant="success" size="xsmall">
					{filteredAssessments.filter((a) => a.effectiveStatus === "implemented").length} implementert
				</Tag>
				<Tag variant="warning" size="xsmall">
					{filteredAssessments.filter((a) => a.effectiveStatus === "partially_implemented").length} delvis
				</Tag>
				<Tag variant="error" size="xsmall">
					{filteredAssessments.filter((a) => a.effectiveStatus === "not_implemented").length} ikke impl.
				</Tag>
				<Tag variant="neutral" size="xsmall">
					{filteredAssessments.filter((a) => !a.effectiveStatus).length} ikke vurdert
				</Tag>
			</HStack>

			{groupedAssessments.map((group) => (
				<VStack key={group.groupLabel || "__all"} gap="space-4">
					{group.groupLabel && (
						<Heading size="small" level="4">
							{group.groupLabel} ({group.items.length})
						</Heading>
					)}
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Kontrollstatus">
						<Table
							size="small"
							sort={controlSort}
							onSortChange={(sortKey) => handleControlSort(sortKey ?? "controlId")}
						>
							<Table.Header>
								<Table.Row>
									<Table.ColumnHeader scope="col" sortKey="domainName" sortable>
										Domene
									</Table.ColumnHeader>
									<Table.ColumnHeader scope="col" sortKey="controlId" sortable>
										Kontroll-ID
									</Table.ColumnHeader>
									<Table.ColumnHeader scope="col" sortKey="controlName" sortable>
										Navn
									</Table.ColumnHeader>
									<Table.ColumnHeader scope="col" sortKey="technologyElementName" sortable>
										Teknologielement
									</Table.ColumnHeader>
									<Table.ColumnHeader scope="col" sortKey="status" sortable>
										Status
									</Table.ColumnHeader>
									<Table.ColumnHeader scope="col" sortKey="establishment" sortable>
										Rutine
									</Table.ColumnHeader>
									<Table.ColumnHeader scope="col" sortKey="routineCompliance" sortable>
										Etterlevelse
									</Table.ColumnHeader>
									<Table.ColumnHeader scope="col">Kommentar</Table.ColumnHeader>
									<Table.HeaderCell />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{group.items.map((a) => (
									<ControlRow key={`${a.controlUuid}:${a.technologyElementId ?? "null"}`} item={a} colSpan={9}>
										<Table.DataCell>{a.domainName}</Table.DataCell>
										<Table.DataCell>
											<Link to={createControlLink(sectionSlug, a.domainCode, a.controlId)}>{a.controlId}</Link>
										</Table.DataCell>
										<Table.DataCell>{a.controlName}</Table.DataCell>
										<Table.DataCell>
											{a.technologyElementName ? (
												<Tag variant="info" size="xsmall">
													{a.technologyElementName}
												</Tag>
											) : null}
										</Table.DataCell>
										<Table.DataCell>
											{a.effectiveStatus ? (
												<ComplianceStatusBadge status={a.effectiveStatus as ComplianceStatus} />
											) : (
												<Tag variant="neutral" size="xsmall">
													Ikke vurdert
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{a.establishment === "established" ? (
												<Link to={`${appBasePath}/kontroll/${a.controlUuid}/rutiner`}>
													<Tag
														variant={establishmentVariants[a.establishment as RoutineEstablishment] ?? "neutral"}
														size="xsmall"
													>
														{establishmentLabels[a.establishment as RoutineEstablishment] ?? a.establishment}
													</Tag>
												</Link>
											) : (
												<Tag
													variant={establishmentVariants[a.establishment as RoutineEstablishment] ?? "neutral"}
													size="xsmall"
												>
													{establishmentLabels[a.establishment as RoutineEstablishment] ?? a.establishment}
												</Tag>
											)}
										</Table.DataCell>
										<Table.DataCell>
											{a.routineCompliance !== "not_applicable" ? (
												<Tag
													variant={complianceVariants[a.routineCompliance as RoutineCompliance] ?? "neutral"}
													size="xsmall"
												>
													{complianceLabels[a.routineCompliance as RoutineCompliance] ?? a.routineCompliance}
												</Tag>
											) : null}
										</Table.DataCell>
									</ControlRow>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			))}

			{notRelevantAssessments.length > 0 && (
				<VStack gap="space-6" style={{ marginTop: "var(--ax-space-16)" }}>
					<Heading size="small" level="3">
						Ikke relevante kontroller
					</Heading>
					<HStack gap="space-8" wrap align="center">
						<BodyShort size="small" textColor="subtle">
							{notRelevantAssessments.length} kontroller
						</BodyShort>
						<Tag variant="neutral" size="xsmall">
							{notRelevantAssessments.length} ikke relevant
						</Tag>
					</HStack>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Ikke relevante kontroller">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.ColumnHeader scope="col">Domene</Table.ColumnHeader>
									<Table.ColumnHeader scope="col">Kontroll-ID</Table.ColumnHeader>
									<Table.ColumnHeader scope="col">Navn</Table.ColumnHeader>
									<Table.ColumnHeader scope="col">Teknologielement</Table.ColumnHeader>
									<Table.ColumnHeader scope="col">Status</Table.ColumnHeader>
									<Table.ColumnHeader scope="col">Kommentar</Table.ColumnHeader>
									<Table.HeaderCell />
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{notRelevantAssessments.map((a) => (
									<ControlRow key={`${a.controlUuid}:${a.technologyElementId ?? "null"}`} item={a} colSpan={7}>
										<Table.DataCell>{a.domainName}</Table.DataCell>
										<Table.DataCell>
											<Link to={createControlLink(sectionSlug, a.domainCode, a.controlId)}>{a.controlId}</Link>
										</Table.DataCell>
										<Table.DataCell>{a.controlName}</Table.DataCell>
										<Table.DataCell>
											{a.technologyElementName ? (
												<Tag variant="info" size="xsmall">
													{a.technologyElementName}
												</Tag>
											) : null}
										</Table.DataCell>
										<Table.DataCell>
											<Tag variant="neutral" size="xsmall">
												Ikke relevant
											</Tag>
										</Table.DataCell>
									</ControlRow>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}
		</VStack>
	)
}
