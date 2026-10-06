import { CheckmarkCircleIcon, MenuElipsisVerticalIcon, PencilIcon, XMarkOctagonIcon } from "@navikt/aksel-icons"
import {
	ActionMenu,
	Alert,
	BodyShort,
	Box,
	Button,
	Detail,
	Dialog,
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
import { githubProfileUrl } from "~/lib/github-user-access"
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
			{displayName ?? subject.username}
		</a>
	)
}

function SubjectIdentityDetails({ subject }: { subject: GithubAccessSubjectWithIdentity }) {
	const displayName = subject.displayName?.trim() || null
	const navIdent = subject.navIdent?.trim() || null
	if (!displayName) return null
	return (
		<HStack gap="space-4" align="center">
			<Detail>
				GitHub-brukernavn:{" "}
				<a href={githubProfileUrl(subject.username)} target="_blank" rel="noopener noreferrer">
					{subject.username}
				</a>
			</Detail>
			{navIdent && <Detail>Nav-ident: {navIdent}</Detail>}
		</HStack>
	)
}

function SubjectIdentityInline({ subject }: { subject: GithubAccessSubjectWithIdentity }) {
	const displayName = subject.displayName?.trim() || null
	const navIdent = subject.navIdent?.trim() || null
	if (!displayName) return null
	return (
		<Detail>
			{subject.username}
			{navIdent && ` · ${navIdent}`}
		</Detail>
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

function AccessSourceSummary({ subject }: { subject: GithubAccessSubject }) {
	const maxVisibleTeams = 2
	const visibleTeams = subject.viaTeams.slice(0, maxVisibleTeams)
	const hiddenTeamCount = subject.viaTeams.length - visibleTeams.length

	return (
		<HStack gap="space-1" wrap>
			{subject.directPermission && (
				<Tag variant="neutral" size="xsmall">
					Direkte
				</Tag>
			)}
			{visibleTeams.map((team) => (
				<Tag key={team.teamSlug} variant="info" size="xsmall" title={`Via team ${team.teamName || team.teamSlug}`}>
					{team.teamName || team.teamSlug}
				</Tag>
			))}
			{hiddenTeamCount > 0 && (
				<Tag variant="info" size="xsmall">
					+{hiddenTeamCount} team
				</Tag>
			)}
		</HStack>
	)
}

function SubjectActions({
	subject,
	onMarkForRemoval,
	onUnmarkForRemoval,
	onMarkForAdjustment,
	onUnmarkForAdjustment,
}: {
	subject: GithubAccessSubject
	onMarkForRemoval: () => void
	onUnmarkForRemoval: () => void
	onMarkForAdjustment: (targetPermission: string) => void
	onUnmarkForAdjustment: () => void
}) {
	const [removalOpen, setRemovalOpen] = useState(false)
	const [adjustmentOpen, setAdjustmentOpen] = useState(false)
	const [targetPermission, setTargetPermission] = useState("")

	return (
		<>
			<ActionMenu>
				<ActionMenu.Trigger>
					<Button
						aria-label={`Handlinger for ${subject.username}`}
						data-color="neutral"
						icon={<MenuElipsisVerticalIcon aria-hidden />}
						size="small"
						variant="tertiary"
					/>
				</ActionMenu.Trigger>
				<ActionMenu.Content>
					{subject.markedForRemoval ? (
						<ActionMenu.Item onSelect={onUnmarkForRemoval}>Angre — behold tilgangen i stedet</ActionMenu.Item>
					) : subject.permissionAdjustmentRequested ? (
						<ActionMenu.Item onSelect={onUnmarkForAdjustment}>
							Angre — behold nåværende tilgangsnivå i stedet
						</ActionMenu.Item>
					) : (
						<>
							<ActionMenu.Item
								onSelect={() => {
									setTargetPermission("")
									setAdjustmentOpen(true)
								}}
							>
								Juster tilgang
							</ActionMenu.Item>
							<ActionMenu.Item variant="danger" onSelect={() => setRemovalOpen(true)}>
								Fjern tilgang
							</ActionMenu.Item>
						</>
					)}
				</ActionMenu.Content>
			</ActionMenu>

			<Dialog open={removalOpen} onOpenChange={setRemovalOpen}>
				<Dialog.Popup
					width="small"
					position="center"
					closeOnOutsideClick
					aria-label={`Fjern tilgang for ${subject.username}`}
				>
					<Dialog.Header>Fjern tilgang?</Dialog.Header>
					<Dialog.Body>
						<VStack gap="space-16">
							<BodyShort size="small">
								Tilgangen merkes for fjerning. Et oppfølgingspunkt opprettes ved fullføring. KISS utfører eller
								bekrefter ikke endringen i GitHub.
							</BodyShort>
							<HStack gap="space-4">
								<Button
									type="button"
									variant="danger"
									size="small"
									onClick={() => {
										setRemovalOpen(false)
										onMarkForRemoval()
									}}
								>
									Merk for fjerning
								</Button>
								<Button type="button" variant="secondary" size="small" onClick={() => setRemovalOpen(false)}>
									Avbryt
								</Button>
							</HStack>
						</VStack>
					</Dialog.Body>
				</Dialog.Popup>
			</Dialog>

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
									.filter((p) => p !== subject.highestPermission)
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
									disabled={targetPermission === ""}
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
	reviewId,
	gitRepository,
	subjects,
	confirmedBy,
	confirmedAt,
	confirmedByName,
	isDraft,
}: {
	activity: ActivityProp
	reviewId: string
	gitRepository: string
	subjects: GithubAccessSubjectWithIdentity[]
	confirmedBy?: string | null
	confirmedAt?: string | null
	confirmedByName?: string | null
	isDraft: boolean
}) {
	const reviewFetcher = useFetcher<ActionResult>()
	const isPending = activity.status === "pending"
	const canEdit = isDraft && isPending

	const activeSubjects = subjects.filter((s) => !s.isGone)
	const goneSubjects = subjects.filter((s) => s.isGone)

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
							<Table.HeaderCell scope="col" />
							<Table.HeaderCell scope="col">Bruker</Table.HeaderCell>
							<Table.HeaderCell scope="col">Høyeste tilgang</Table.HeaderCell>
							<Table.HeaderCell scope="col">Kilde</Table.HeaderCell>
							<Table.HeaderCell scope="col">Status</Table.HeaderCell>
							<Table.HeaderCell scope="col" align="right">
								Handlinger
							</Table.HeaderCell>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{activeSubjects.map((subject) => (
							<Table.ExpandableRow
								key={subject.username}
								content={
									<VStack gap="space-4">
										<SubjectIdentityDetails subject={subject} />
										<AccessSourceDetails subject={subject} />
										{subject.markedForRemoval ? (
											<Box background="danger-soft" padding="space-8" borderRadius="4">
												<Detail weight="semibold">Merket for fjerning — følges opp etter fullføring.</Detail>
											</Box>
										) : subject.permissionAdjustmentRequested ? (
											<Box background="info-soft" padding="space-8" borderRadius="4">
												<Detail weight="semibold">
													Justering: {subject.highestPermission} → {subject.targetPermission}
												</Detail>
											</Box>
										) : null}
									</VStack>
								}
								colSpan={6}
							>
								<Table.DataCell>
									<HStack gap="space-2" align="center">
										<SubjectIdentity subject={subject} />
										{subject.isNew && (
											<Tag variant="info" size="xsmall">
												Ny
											</Tag>
										)}
									</HStack>
								</Table.DataCell>
								<Table.DataCell>
									<GithubPermissionTag permission={subject.highestPermission} />
								</Table.DataCell>
								<Table.DataCell>
									<AccessSourceSummary subject={subject} />
								</Table.DataCell>
								<Table.DataCell>
									{subject.markedForRemoval ? (
										<Tag variant="error" size="xsmall" icon={<XMarkOctagonIcon aria-hidden />}>
											Merket for fjerning
										</Tag>
									) : subject.permissionAdjustmentRequested ? (
										<Tag variant="info" size="xsmall" icon={<PencilIcon aria-hidden />}>
											Justering markert
										</Tag>
									) : (
										<Tag variant="neutral" size="xsmall">
											Ingen beslutning
										</Tag>
									)}
								</Table.DataCell>
								<Table.DataCell align="right">
									{canEdit && (
										<SubjectActions
											subject={subject}
											onMarkForRemoval={() => handleMarkForRemoval(subject.username)}
											onUnmarkForRemoval={() => handleUnmarkForRemoval(subject.username)}
											onMarkForAdjustment={(targetPermission) =>
												handleMarkForAdjustment(subject.username, targetPermission)
											}
											onUnmarkForAdjustment={() => handleUnmarkForAdjustment(subject.username)}
										/>
									)}
								</Table.DataCell>
							</Table.ExpandableRow>
						))}
					</Table.Body>
				</Table>
				{activeSubjects.length === 0 && (
					<BodyShort size="small" textColor="subtle" style={{ padding: "var(--ax-space-16)" }}>
						Ingen personer med tilgang.
					</BodyShort>
				)}
			</section>

			{goneSubjects.length > 0 && (
				<VStack gap="space-2">
					<Detail weight="semibold">Fjernet siden forrige gjennomgang ({goneSubjects.length})</Detail>
					{/* biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions need keyboard access per WCAG 2.1 */}
					<section className="table-scroll" tabIndex={0} aria-label="Personer fjernet siden forrige gjennomgang">
						<Table size="small">
							<Table.Header>
								<Table.Row>
									<Table.HeaderCell scope="col">Bruker</Table.HeaderCell>
									<Table.HeaderCell scope="col">Siste kjente tilgang</Table.HeaderCell>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{goneSubjects.map((subject) => (
									<Table.Row key={subject.username} style={{ backgroundColor: "var(--ax-bg-danger-soft)" }}>
										<Table.DataCell>
											<VStack gap="space-1">
												<SubjectIdentity subject={subject} />
												<SubjectIdentityInline subject={subject} />
											</VStack>
										</Table.DataCell>
										<Table.DataCell>
											<GithubPermissionTag permission={subject.highestPermission} />
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
						<BodyShort weight="semibold">Fullføring av Github-tilgangsgjennomgang</BodyShort>
						<BodyShort size="small">
							Bekrefter at resterende personer har tjenstlig behov for tilgangen. Personer merket for fjerning eller
							justering får automatisk et preutfylt oppfølgingspunkt som må adresseres.
						</BodyShort>
						<HStack gap="space-4" align="center" wrap>
							<Button type="button" size="small" onClick={handleConfirmReview}>
								Bekreft tjenstlig behov for alle
							</Button>
							<Button
								as="a"
								href={`/api/gjennomgang/${reviewId}/github-tilgang.pdf`}
								target="_blank"
								rel="noopener noreferrer"
								type="button"
								variant="secondary"
								size="small"
							>
								Forhåndsvis PDF-revisjonsbevis
							</Button>
						</HStack>
						{confirmedAt && (
							<Detail>
								Bekreftet av <UserDisplayName navIdent={confirmedBy ?? "—"} name={confirmedByName} />{" "}
								{formatDateTimeOslo(confirmedAt)}
							</Detail>
						)}
					</VStack>
				</Box>
			)}
		</VStack>
	)
}
