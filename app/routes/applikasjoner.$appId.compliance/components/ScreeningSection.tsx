import { Link as AkselLink, Alert, BodyLong, BodyShort, Heading, HStack, Tag, VStack } from "@navikt/ds-react"
import type {
	EconomyClassificationData,
	EntraGroupsData,
	OracleRolesData,
	PersistenceEntry,
	RulesetOption,
	ScreeningQuestion,
} from "../shared"
import { isQuestionAnswered, slugify } from "../shared"
import { EconomySystemSection } from "./EconomySystemSection"
import { EntraGroupsSection } from "./EntraGroupsSection"
import { OracleRolesScreeningSection } from "./OracleRolesScreeningSection"
import { PersistenceSection } from "./PersistenceSection"
import { RulesetSection } from "./RulesetSection"
import { ScreeningAnswerForm } from "./ScreeningAnswerForm"

type Props = {
	screening: ScreeningQuestion[]
	persistence: PersistenceEntry[]
	rulesetOptions: RulesetOption[]
	entraGroupsData: EntraGroupsData
	oracleRolesData: OracleRolesData
	economyClassification: EconomyClassificationData
	canAdmin: boolean
}

export function ScreeningSidebar({
	screening,
	economyClassification,
}: {
	screening: ScreeningQuestion[]
	economyClassification?: EconomyClassificationData
}) {
	return (
		<nav className="compliance-sidebar" aria-label="Innholdsnavigasjon">
			<AkselLink href="#top" className="compliance-sidebar-home">
				Hjem
			</AkselLink>

			{screening.map((q) => (
				<div key={q.id} className="compliance-sidebar-group">
					<AkselLink href={`#q-${slugify(q.questionText)}`} className="compliance-sidebar-question">
						<span className="compliance-sidebar-question-icon">
							{isQuestionAnswered(q, economyClassification) ? "✓" : "○"}
						</span>
						<span className="compliance-sidebar-question-text">{q.questionText}</span>
					</AkselLink>
				</div>
			))}
		</nav>
	)
}

export function ScreeningSection({
	screening,
	persistence,
	rulesetOptions,
	entraGroupsData,
	oracleRolesData,
	economyClassification,
	canAdmin,
}: Props) {
	const answeredCount = screening.filter((q) => isQuestionAnswered(q, economyClassification)).length

	return (
		<>
			<HStack gap="space-6" align="center">
				<BodyShort size="small" textColor="subtle">
					{answeredCount} av {screening.length} spørsmål besvart
				</BodyShort>
			</HStack>

			{screening.length > 0 && (
				<VStack gap="space-8" id="screening" className="compliance-domain-section">
					<Heading size="large" level="3">
						Innledende spørsmål
					</Heading>
					<BodyLong size="small">
						Svar på spørsmålene under for å automatisk klassifisere relevante kontrollpunkter.
					</BodyLong>
					<VStack gap="space-6">
						{screening.map((q) => (
							<div key={q.id} id={`q-${slugify(q.questionText)}`} className="compliance-card">
								<VStack gap="space-4">
									<Heading size="small" level="4">
										{q.questionText}
									</Heading>
									{q.descriptionHtml && (
										// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify
										<div className="markdown-content" dangerouslySetInnerHTML={{ __html: q.descriptionHtml }} />
									)}
									{q.affectedControls.length > 0 && (
										<HStack gap="space-2" wrap>
											<BodyShort size="small" textColor="subtle">
												Påvirker:
											</BodyShort>
											{q.affectedControls.map((controlId) => (
												<Tag key={controlId} variant="neutral" size="xsmall">
													{controlId}
												</Tag>
											))}
										</HStack>
									)}
									{q.answerType === "persistence" ? (
										<PersistenceSection entries={persistence} questionId={q.id} confirmed={q.answer === "confirmed"} />
									) : q.answerType === "entra_id_groups" ? (
										<EntraGroupsSection
											entraGroupsData={entraGroupsData}
											questionId={q.id}
											confirmed={q.answer === "confirmed"}
										/>
									) : q.answerType === "oracle_roles" ? (
										<OracleRolesScreeningSection
											oracleRolesData={oracleRolesData}
											questionId={q.id}
											confirmed={q.answer === "confirmed"}
											canAdmin={canAdmin}
										/>
									) : q.answerType === "ruleset" ? (
										<RulesetSection question={q} rulesets={rulesetOptions} />
									) : q.answerType === "economy_system" ? (
										<EconomySystemSection
											classification={economyClassification}
											questionId={q.id}
											confirmed={q.answer === "confirmed"}
										/>
									) : (
										<ScreeningAnswerForm question={q} />
									)}
								</VStack>
							</div>
						))}
					</VStack>
				</VStack>
			)}

			{screening.length === 0 && (
				<Alert variant="info" size="small">
					Det er ingen godkjente innledende spørsmål for denne seksjonen ennå.
				</Alert>
			)}
		</>
	)
}
