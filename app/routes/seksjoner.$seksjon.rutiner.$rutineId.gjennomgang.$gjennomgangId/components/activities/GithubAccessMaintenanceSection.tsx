import { CheckmarkCircleIcon, PencilIcon, XMarkOctagonIcon } from "@navikt/aksel-icons"
import {
	Alert,
	BodyShort,
	Box,
	Button,
	Detail,
	Dialog,
	Heading,
	HStack,
	Select,
	Table,
	Tag,
	VStack,
} from "@navikt/ds-react"
import { useState } from "react"
import { useFetcher } from "react-router"
import { GithubPermissionTag } from "~/components/GithubPermissionTag"
import { UserDisplayName } from "~/components/UserDisplayName"
import type { GithubAccessSubject } from "~/lib/github-access-staged-data"
import { githubAccessPermissionValues } from "~/lib/github-access-staged-data"
import { githubProfileUrl, normalizeGithubPermission } from "~/lib/github-user-access"
import { formatDateTimeOslo } from "~/lib/utils"
import type { ActionResult, ActivityProp } from "../shared"

export type GithubAccessSubjectWithIdentity = GithubAccessSubject & {
	displayName?: string | null
	navIdent?: string | null
}

function SubjectIdentity({ subject }: { subject: GithubAccessSubjectWithIdentity }) {
	const displayName = subject.displayName?.trim() || null
	return (
		<a href={githubProfileUrl(subject.username)} target="_blank" rel="noopener noreferrer">
			{displayName ? `${displayName} (${subject.username})` : subject.username}
		</a>
	)
}

function AccessSourceDetails({ subject }: { subject: GithubAccessSubject }) {
	return (
		<VStack gap="space-1">
			{subject.directPermission && (
				<HStack gap="space-2" align="center">
					<Detail weight="semibold">Direkte:</Detail>
					<GithubPermissionTag permission={subject.directPermission} />
				</HStack>
			)}
			{subject.viaTeams.map((team) => (
				<HStack key={team.teamSlug} gap="space-2" align="center">
					<Detail weight="semibold">Via team {team.teamName || team.teamSlug}:</Detail>
					<GithubPermissionTag permission={team.permission} />
				</HStack>
			))}
		</VStack>
	)
}

function SubjectActions({
	subject,
	disabled,
	onMarkForRemoval,
	onMarkForAdjustment,
}: {
	subject: GithubAccessSubject
	disabled: boolean
	onMarkForRemoval: () => void
	onMarkForAdjustment: (targetPermission: string) => void
}) {
	const [adjustmentOpen, setAdjustmentOpen] = useState(false)
	const [targetPermission, setTargetPermission] = useState("")

	return (
		<>
			<HStack gap="space-2" justify="end">
				<Button
					type="button"
					data-color="neutral"
					variant="tertiary"
					size="small"
					disabled={disabled}
					aria-label={`Endre tilgang for ${subject.username}`}
					onClick={() => {
						setTargetPermission("")
						setAdjustmentOpen(true)
					}}
				>
					Endre
				</Button>
				<Button
					type="button"
					data-color="danger"
					variant="tertiary"
					size="small"
					disabled={disabled}
					loading={disabled}
					aria-label={`Fjern tilgang for ${subject.username}`}
					onClick={onMarkForRemoval}
				>
					Fjern
				</Button>
			</HStack>

			<Dialog open={adjustmentOpen} onOpenChange={setAdjustmentOpen}>
				<Dialog.Popup
					width="small"
					position="center"
					closeOnOutsideClick
					aria-label={`Juster tilgang for ${subject.username}`}
				>
					<Dialog.Header>Juster tilgang</Dialog.Header>
					<Dialog.Body>
						<VStack gap="space-16">
							<Select
								label="Nytt tilgangsnivå"
								description="Velg hvilket tilgangsnivå personen skal ha etter justering."
								size="small"
								value={targetPermission}
								onChange={(e) => setTargetPermission(e.target.value)}
							>
								<option value="">Velg tilgangsnivå…</option>
								{githubAccessPermissionValues
									.filter(
										(p, index, all) =>
											normalizeGithubPermission(p) !== normalizeGithubPermission(subject.highestPermission) &&
											all.findIndex((other) => normalizeGithubPermission(other) === normalizeGithubPermission(p)) ===
												index,
									)
									.map((p) => (
										<option key={p} value={p}>
											{p}
										</option>
									))}
							</Select>
							<BodyShort size="small">
								Et oppfølgingspunkt opprettes ved fullføring. KISS utfører eller bekrefter ikke endringen i GitHub.
							</BodyShort>
							<HStack gap="space-4">
								<Button
									type="button"
									variant="secondary"
									size="small"
									disabled={disabled || targetPermission === ""}
									loading={disabled}
									onClick={() => {
										setAdjustmentOpen(false)
										onMarkForAdjustment(targetPermission)
									}}
								>
									Merk for justering
								</Button>
								<Button type="button" variant="tertiary" size="small" onClick={() => setAdjustmentOpen(false)}>
									Avbryt
								</Button>
							</HStack>
						</VStack>
					</Dialog.Body>
				</Dialog.Popup>
			</Dialog>
		</>
	)
}

export function GithubAccessMaintenanceSection({
	activity,
	gitRepository,
	subjects,
	confirmedBy,
	confirmedAt,
	confirmedByName,
	isDraft,
}: {
	activity: ActivityProp
	gitRepository: string
	subjects: GithubAccessSubjectWithIdentity[]
	confirmedBy?: string | null
	confirmedAt?: string | null
	confirmedByName?: string | null
	isDraft: boolean
}) {
	const reviewFetcher = useFetcher<ActionResult>()
	const isSubmitting = reviewFetcher.state !== "idle"
	const isPending = activity.status === "pending"
	const canEdit = isDraft && isPending

	const pendingSubjects = subjects.filter((s) => !s.markedForRemoval && !s.permissionAdjustmentRequested)
	const decidedSubjects = subjects.filter((s) => s.markedForRemoval || s.permissionAdjustmentRequested)

	const handleMarkForRemoval = (username: string) => {
		reviewFetcher.submit({ intent: "mark-github-access-subject-for-removal", username }, { method: "POST" })
	}

	const handleUnmarkForRemoval = (username: string) => {
		reviewFetcher.submit({ intent: "unmark-github-access-subject-for-removal", username }, { method: "POST" })
	}

	const handleMarkForAdjustment = (username: string, targetPermission: string) => {
		reviewFetcher.submit(
			{ intent: "mark-github-access-subject-for-adjustment", username, targetPermission },
			{ method: "POST" },
		)
	}

	const handleUnmarkForAdjustment = (username: string) => {
		reviewFetcher.submit({ intent: "unmark-github-access-subject-for-adjustment", username }, { method: "POST" })
	}

	const handleConfirmReview = () => {
		reviewFetcher.submit({ intent: "confirm-github-access-review" }, { method: "POST" })
	}

	return (
		<VStack gap="space-6">
			<HStack gap="space-4" align="center">
				<Detail>
					Repo: <span style={{ fontFamily: "monospace" }}>{gitRepository}</span>
				</Detail>
			</HStack>

			{reviewFetcher.data?.success === false && (
				<Alert variant="error" size="small">
					{reviewFetcher.data.error ?? "Noe gikk galt. Prøv igjen."}
				</Alert>
			)}

			{(isPending ? confirmedAt !== null : true) && (
				<HStack gap="space-4" align="center">
					<Tag variant="success" size="medium" icon={<CheckmarkCircleIcon aria-hidden />}>
						{isPending ? "Bekreftet" : "Fullført"}
					</Tag>
					{confirmedAt && (
						<Detail>
							Bekreftet av <UserDisplayName navIdent={confirmedBy ?? "—"} name={confirmedByName} />{" "}
							{formatDateTimeOslo(confirmedAt)}
						</Detail>
					)}
				</HStack>
			)}

			<VStack gap="space-0">
				<BodyShort size="small" textColor="subtle">
					Alle personer med tilgang er hentet automatisk fra GitHub (direkte tilgang og via team).
				</BodyShort>
				<BodyShort size="small" textColor="subtle">
					Fjern eller juster tilgang for enkeltpersoner ved behov, og bekreft til slutt at resten har tjenstlig behov
					for tilgangen.
				</BodyShort>
			</VStack>

			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
			<section className="table-scroll" tabIndex={0} aria-label="Personer med GitHub-tilgang">
				<Table size="small">
					<Table.Header>
						<Table.Row>
							<Table.HeaderCell scope="col">Bruker</Table.HeaderCell>
							<Table.HeaderCell scope="col">Høyeste tilgang</Table.HeaderCell>
							<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
							<Table.HeaderCell scope="col" align="right">
								Handlinger
							</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{pendingSubjects.map((subject) => (
							<Table.Row key={subject.username}>
								<Table.DataCell>
									<SubjectIdentity subject={subject} />
								</Table.DataCell>
								<Table.DataCell>
									<GithubPermissionTag permission={subject.highestPermission} />
								</Table.DataCell>
								<Table.DataCell>
									<AccessSourceDetails subject={subject} />
								</Table.DataCell>
								<Table.DataCell align="right">
									{canEdit && (
										<SubjectActions
											subject={subject}
											disabled={isSubmitting}
											onMarkForRemoval={() => handleMarkForRemoval(subject.username)}
											onMarkForAdjustment={(targetPermission) =>
												handleMarkForAdjustment(subject.username, targetPermission)
											}
										/>
									)}
								</Table.DataCell>
							</Table.Row>
						))}
					</Table.Body>
				</Table>
				{pendingSubjects.length === 0 && (
					<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-16)" }}>
						Ingen gjenstående personer å vurdere.
					</BodyShort>
				)}
			</section>

			{decidedSubjects.length > 0 && (
				<VStack gap="space-4">
					<Heading size="small" level="4">
						Tilganger som skal endres ({decidedSubjects.length})
					</Heading>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Tilganger som skal endres">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Bruker</Table.HeaderCell>
									<Table.HeaderCell scope="col">Høyeste tilgang</Table.HeaderCell>
									<Table.HeaderCell scope="col">Endring</Table.HeaderCell>
									<Table.HeaderCell scope="col" align="right">
										Handlinger
									</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{decidedSubjects.map((subject) => (
									<Table.Row key={subject.username}>
										<Table.DataCell>
											<SubjectIdentity subject={subject} />
										</Table.DataCell>
										<Table.DataCell>
											<GithubPermissionTag permission={subject.highestPermission} />
										</Table.DataCell>
										<Table.DataCell>
											<VStack gap="space-1">
												{subject.markedForRemoval ? (
													<Tag variant="error" size="xsmall" icon={<XMarkOctagonIcon aria-hidden />}>
														Skal fjernes
													</Tag>
												) : (
													<Tag variant="info" size="xsmall" icon={<PencilIcon aria-hidden />}>
														Skal endres
													</Tag>
												)}
												{subject.permissionAdjustmentRequested && (
													<Detail>
														{subject.highestPermission} → {subject.targetPermission}
													</Detail>
												)}
											</VStack>
										</Table.DataCell>
										<Table.DataCell align="right">
											{canEdit && (
												<Button
													type="button"
													variant="tertiary"
													size="small"
													disabled={isSubmitting}
													aria-label={`Angre markering for ${subject.username}`}
													onClick={() =>
														subject.markedForRemoval
															? handleUnmarkForRemoval(subject.username)
															: handleUnmarkForAdjustment(subject.username)
													}
												>
													Angre
												</Button>
											)}
										</Table.DataCell>
									</Table.Row>
								))}
							</Table.Body>
						</Table>
					</section>
				</VStack>
			)}

			{canEdit && (
				<Box padding="space-8" borderWidth="1" borderColor="info" borderRadius="8" background="info-softA">
					<VStack gap="space-4">
						<BodyShort weight="semibold">Fullføring av GitHub-tilgangsgjennomgang</BodyShort>
						<BodyShort size="small">
							Bekrefter at resterende personer har tjenstlig behov for tilgangen. Tilganger som skal fjernes eller
							endres får automatisk et preutfylt oppfølgingspunkt som må adresseres.
						</BodyShort>
						<HStack gap="space-4" align="center" wrap>
							<Button
								type="button"
								size="small"
								onClick={handleConfirmReview}
								disabled={isSubmitting}
								loading={isSubmitting}
							>
								Bekreft tjenstlig behov resterende
							</Button>
						</HStack>
					</VStack>
				</Box>
			)}
		</VStack>
	)
}
