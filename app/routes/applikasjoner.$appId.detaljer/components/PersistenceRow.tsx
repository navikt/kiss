import { TrashIcon } from "@navikt/aksel-icons"
import {
	Link as AkselLink,
	Button,
	Detail,
	HStack,
	ReadMore,
	Select,
	Table,
	Tag,
	TextField,
	VStack,
} from "@navikt/ds-react"
import type { MouseEvent } from "react"
import { useCallback, useEffect, useRef } from "react"
import { useFetcher } from "react-router"
import { type DataClassification, dataClassificationLabels } from "~/db/schema/applications"
import { conclusionConfig, findingSeverityVariant, persistenceLabels, persistenceVariants } from "../shared"

export function PersistenceRow({
	p,
	oracleAuditSummaries,
}: {
	p: {
		id: string
		type: string
		name: string
		version: string | null
		tier: string | null
		highAvailability: boolean | null
		auditLogging: boolean | null
		auditLogUrl: string | null
		missingAuditFlags: string[] | null
		oracleInstanceId: string | null
		dataClassification: string | null
		dataClassificationJustification: string | null
		manuallyAdded: boolean
	}
	oracleAuditSummaries: Record<
		string,
		{
			conclusion: string
			reason: string
			findings: Array<{ severity: string; message: string }>
		}
	>
}) {
	const classificationFetcher = useFetcher()
	const archiveFetcher = useFetcher()
	const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
	const archiveFormRef = useRef<HTMLFormElement | null>(null)
	const pendingArchiveRef = useRef(false)
	const flushClassificationForm = useCallback(() => {
		if (submitTimer.current) {
			clearTimeout(submitTimer.current)
			submitTimer.current = null
		}
		const form = document.getElementById(`classification-form-${p.id}`) as HTMLFormElement | null
		if (form) classificationFetcher.submit(form)
	}, [p.id, classificationFetcher])
	useEffect(
		() => () => {
			if (submitTimer.current) flushClassificationForm()
		},
		[flushClassificationForm],
	)
	// Hvis en klassifiserings-lagring venter når arkivering trigges, må den
	// fullføres FØR arkiveringen sendes — ellers kan arkiveringen commit-e
	// først og den ventende lagringen bli avvist mot den nå arkiverte raden,
	// slik at redigeringen forsvinner og audit-loggen mangler den.
	useEffect(() => {
		if (pendingArchiveRef.current && classificationFetcher.state === "idle") {
			pendingArchiveRef.current = false
			archiveFormRef.current?.requestSubmit()
		}
	}, [classificationFetcher.state])
	const scheduleSubmit = () => {
		if (submitTimer.current) clearTimeout(submitTimer.current)
		submitTimer.current = setTimeout(() => {
			submitTimer.current = null
			const form = document.getElementById(`classification-form-${p.id}`) as HTMLFormElement | null
			if (form) classificationFetcher.submit(form)
		}, 400)
	}
	const handleArchiveClick = (e: MouseEvent<HTMLButtonElement>) => {
		if (submitTimer.current) {
			e.preventDefault()
			pendingArchiveRef.current = true
			flushClassificationForm()
		} else if (classificationFetcher.state !== "idle") {
			// En lagring er allerede underveis (f.eks. trigget rett før klikket) —
			// vent på at den fullfører før arkiveringen sendes, uten å sende den på nytt.
			e.preventDefault()
			pendingArchiveRef.current = true
		}
	}

	return (
		<Table.Row>
			<Table.DataCell>
				<HStack gap="space-2" align="center">
					<Tag variant={persistenceVariants[p.type] ?? "neutral"} size="xsmall">
						{persistenceLabels[p.type] ?? p.type}
					</Tag>
					{p.manuallyAdded && (
						<Tag variant="neutral" size="xsmall">
							Manuelt
						</Tag>
					)}
					{!p.manuallyAdded && p.oracleInstanceId && p.oracleInstanceId === p.name && (
						<Tag variant="neutral" size="xsmall">
							Manuelt konfigurert
						</Tag>
					)}
				</HStack>
			</Table.DataCell>
			<Table.DataCell>{p.name}</Table.DataCell>
			<Table.DataCell>
				<classificationFetcher.Form method="post" id={`classification-form-${p.id}`}>
					<input type="hidden" name="intent" value="update-classification" />
					<input type="hidden" name="persistenceId" value={p.id} />
				</classificationFetcher.Form>
				<Select
					label="Dataklassifisering"
					hideLabel
					size="small"
					name="dataClassification"
					form={`classification-form-${p.id}`}
					defaultValue={p.dataClassification ?? ""}
					onChange={() => scheduleSubmit()}
				>
					<option value="">Ikke satt</option>
					{(Object.entries(dataClassificationLabels) as [DataClassification, string][]).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</Select>
			</Table.DataCell>
			<Table.DataCell>
				<TextField
					label="Begrunnelse (valgfritt)"
					hideLabel
					size="small"
					name="dataClassificationJustification"
					form={`classification-form-${p.id}`}
					defaultValue={p.dataClassificationJustification ?? ""}
					onBlur={() => scheduleSubmit()}
				/>
			</Table.DataCell>
			<Table.DataCell>{p.version ?? "–"}</Table.DataCell>
			<Table.DataCell>{p.tier ?? "–"}</Table.DataCell>
			<Table.DataCell>
				{p.highAvailability === true ? (
					<Tag variant="success" size="xsmall">
						Ja
					</Tag>
				) : p.highAvailability === false ? (
					<Tag variant="error" size="xsmall">
						Nei
					</Tag>
				) : (
					"–"
				)}
			</Table.DataCell>
			<Table.DataCell>
				{p.type === "oracle" && oracleAuditSummaries[p.id] ? (
					<VStack gap="space-2">
						<Tag variant={conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.variant ?? "neutral"} size="xsmall">
							{conclusionConfig[oracleAuditSummaries[p.id].conclusion]?.label ?? oracleAuditSummaries[p.id].conclusion}
						</Tag>
						<Detail style={{ color: "var(--ax-text-subtle)" }}>{oracleAuditSummaries[p.id].reason}</Detail>
						{oracleAuditSummaries[p.id].findings.length > 0 && (
							<ReadMore header="Funn" size="small" defaultOpen={false}>
								<VStack gap="space-2">
									{oracleAuditSummaries[p.id].findings.map((f, i) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: static findings list
										<HStack key={i} gap="space-2" align="center" wrap>
											<Tag variant={findingSeverityVariant[f.severity] ?? "info"} size="xsmall">
												{f.severity}
											</Tag>
											<Detail>{f.message}</Detail>
										</HStack>
									))}
								</VStack>
							</ReadMore>
						)}
					</VStack>
				) : p.auditLogging === true ? (
					<VStack gap="space-1">
						{p.auditLogUrl ? (
							<AkselLink href={p.auditLogUrl} target="_blank" rel="noopener noreferrer">
								<Tag
									variant={p.missingAuditFlags && p.missingAuditFlags.length > 0 ? "warning" : "success"}
									size="xsmall"
								>
									{p.missingAuditFlags && p.missingAuditFlags.length > 0
										? "Ja, men mangler flagg – se logg (åpnes i nytt vindu)"
										: "Ja – se logg (åpnes i nytt vindu)"}
								</Tag>
							</AkselLink>
						) : (
							<Tag
								variant={p.missingAuditFlags && p.missingAuditFlags.length > 0 ? "warning" : "success"}
								size="xsmall"
							>
								{p.missingAuditFlags && p.missingAuditFlags.length > 0 ? "Ja, men mangler flagg" : "Ja"}
							</Tag>
						)}
						{p.missingAuditFlags && p.missingAuditFlags.length > 0 && (
							<Detail style={{ color: "var(--ax-text-subtle)" }}>
								{p.missingAuditFlags.length > 1 ? "Mangler anbefalte flagg" : "Mangler anbefalt flagg"}:{" "}
								{p.missingAuditFlags.join(", ")}
							</Detail>
						)}
					</VStack>
				) : p.auditLogging === false ? (
					<Tag variant="error" size="xsmall">
						Nei
					</Tag>
				) : (
					"–"
				)}
			</Table.DataCell>
			<Table.DataCell>
				{p.manuallyAdded && (
					<archiveFetcher.Form method="post" ref={archiveFormRef}>
						<input type="hidden" name="intent" value="archive-persistence" />
						<input type="hidden" name="persistenceId" value={p.id} />
						<Button
							type="submit"
							variant="tertiary-neutral"
							size="xsmall"
							icon={<TrashIcon aria-hidden />}
							loading={archiveFetcher.state !== "idle" || pendingArchiveRef.current}
							onClick={handleArchiveClick}
						>
							Arkiver
						</Button>
					</archiveFetcher.Form>
				)}
			</Table.DataCell>
		</Table.Row>
	)
}
