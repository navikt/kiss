import { BodyShort, Button, Checkbox, CheckboxGroup, Select, TextField, VStack } from "@navikt/ds-react"
import { Form } from "react-router"
import { MarkdownEditor } from "~/components/MarkdownEditor"
import type { PendingChoice } from "../shared"

type TechnologyElement = { id: string; name: string }

type Question = {
	questionText: string
	description: string | null
	answerType: string | null
	technologyElementIds: string[]
}

export function QuestionForm({
	isNew,
	question,
	technologyElements,
	sectionId,
	returnPath,
	pendingChoices,
	answerType,
	onAnswerTypeChange,
}: {
	isNew: boolean
	question: Question
	technologyElements: TechnologyElement[]
	sectionId: string | null
	returnPath: string
	pendingChoices: PendingChoice[]
	answerType: string
	onAnswerTypeChange: (newType: string, prevType: string) => void
}) {
	// TODO: flytt inline padding/maxWidth-stiler til CSS når CSS-modul-mønster innføres i prosjektet
	return (
		<Form method="post" style={{ padding: "6px" }}>
			<input type="hidden" name="intent" value="updateQuestion" />
			<input type="hidden" name="returnPath" value={returnPath} />
			{sectionId && <input type="hidden" name="sectionId" value={sectionId} />}
			{isNew && <input type="hidden" name="pendingChoices" value={JSON.stringify(pendingChoices)} />}
			<VStack gap="space-8">
				<TextField label="Spørsmålstekst" name="questionText" size="small" defaultValue={question.questionText} />
				<MarkdownEditor label="Beskrivelse" name="description" defaultValue={question.description ?? ""} minRows={5} />
				{technologyElements.length > 0 && (
					<CheckboxGroup
						legend="Teknologielementer"
						description="Velg hvilke teknologielementer spørsmålet gjelder for. Ingen valg betyr at spørsmålet gjelder for alle applikasjoner."
						size="small"
						defaultValue={question.technologyElementIds}
					>
						{technologyElements.map((te) => (
							<Checkbox key={te.id} name="technologyElementIds" value={te.id}>
								{te.name}
							</Checkbox>
						))}
					</CheckboxGroup>
				)}
				<Select
					label="Svartype"
					name="answerType"
					size="small"
					value={answerType}
					onChange={(e) => onAnswerTypeChange(e.target.value, answerType)}
					style={{ maxWidth: "20rem" }}
				>
					<option value="" disabled>
						– Velg svartype –
					</option>
					<option value="boolean">Ja/Nei</option>
					<option value="single_choice">Egendefinerte valg</option>
					<option value="persistence">Persistens (databaser)</option>
					<option value="entra_id_groups">Entra ID-grupper</option>
					<option value="ruleset">Regelsett</option>
				</Select>
				{answerType === "persistence" && (
					<BodyShort size="small" textColor="subtle">
						Spørsmål av typen «Persistens» lar brukeren oppgi hvilke databaser applikasjonen bruker, med type, navn og
						klassifisering. Ingen valgmuligheter eller effekter trengs.
					</BodyShort>
				)}
				{answerType === "entra_id_groups" && (
					<BodyShort size="small" textColor="subtle">
						Spørsmål av typen «Entra ID-grupper» lar brukeren vedlikeholde tilgangsgrupper for applikasjonen, med
						kritikalitetsvurdering. Ingen valgmuligheter eller effekter trengs.
					</BodyShort>
				)}
				{answerType === "ruleset" && (
					<BodyShort size="small" textColor="subtle">
						Spørsmål av typen «Regelsett» lar brukeren velge et regelsett fra seksjonen som svar. Ingen valgmuligheter
						eller effekter trengs.
					</BodyShort>
				)}
				<div>
					<Button type="submit" size="small" variant="primary">
						{isNew ? "Opprett spørsmål" : "Lagre endringer"}
					</Button>
				</div>
			</VStack>
		</Form>
	)
}
