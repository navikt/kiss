import { Heading, VStack } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { useLoaderData } from "react-router"
import { RouteErrorBoundary } from "~/components/RouteErrorBoundary"
import { ChoicesSection } from "./components/ChoicesSection"
import { DeleteConfirmModal } from "./components/DeleteConfirmModal"
import { QuestionForm } from "./components/QuestionForm"
import type { loader } from "./loader.server"
import type { DeleteTarget, PendingChoice } from "./shared"

export { action } from "./action.server"
export { loader } from "./loader.server"
export { RouteErrorBoundary as ErrorBoundary }

export default function EditScreeningQuestion() {
	const { isNew, question, choices, controls, technologyElements, sectionId, returnPath } =
		useLoaderData<typeof loader>()
	const [pendingChoices, setPendingChoices] = useState<PendingChoice[]>([])
	const [answerType, setAnswerType] = useState(question.answerType ?? "")
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
	const deleteModalRef = useRef<HTMLDialogElement>(null)

	function handleAnswerTypeChange(newType: string, prevType: string) {
		setAnswerType(newType)
		if (newType === "boolean" && isNew) {
			setPendingChoices([
				{
					clientId: crypto.randomUUID(),
					label: "Ja",
					requiresComment: false,
					requiresLink: false,
					displayOrder: 0,
					effects: [],
				},
				{
					clientId: crypto.randomUUID(),
					label: "Nei",
					requiresComment: false,
					requiresLink: false,
					displayOrder: 1,
					effects: [],
				},
			])
		} else if (prevType === "boolean" && newType !== "boolean" && isNew) {
			setPendingChoices((prev) => {
				const isDefault =
					prev.length === 2 &&
					prev[0].label === "Ja" &&
					prev[1].label === "Nei" &&
					prev.every((c) => c.effects.length === 0 && !c.requiresComment && !c.requiresLink)
				return isDefault ? [] : prev
			})
		}
	}

	// TODO: flytt inline maxWidth-stil til CSS når CSS-modul-mønster innføres i prosjektet
	return (
		<VStack gap="space-8" style={{ maxWidth: "64rem" }}>
			<Heading size="xlarge" level="2">
				{isNew ? "Nytt spørsmål" : "Rediger spørsmål"}
			</Heading>

			<QuestionForm
				isNew={isNew}
				question={question}
				technologyElements={technologyElements}
				sectionId={sectionId}
				returnPath={returnPath}
				pendingChoices={pendingChoices}
				answerType={answerType}
				onAnswerTypeChange={handleAnswerTypeChange}
			/>

			<ChoicesSection
				isNew={isNew}
				answerType={answerType}
				choices={choices}
				pendingChoices={pendingChoices}
				controls={controls}
				onAddPendingChoice={(choice) => setPendingChoices((prev) => [...prev, choice])}
				onRemovePendingChoice={(clientId) => setPendingChoices((prev) => prev.filter((c) => c.clientId !== clientId))}
				onAddPendingEffect={(choiceClientId, eff) =>
					setPendingChoices((prev) =>
						prev.map((c) => (c.clientId === choiceClientId ? { ...c, effects: [...c.effects, eff] } : c)),
					)
				}
				onRemovePendingEffect={(choiceClientId, effClientId) =>
					setPendingChoices((prev) =>
						prev.map((c) =>
							c.clientId === choiceClientId
								? { ...c, effects: c.effects.filter((e) => e.clientId !== effClientId) }
								: c,
						),
					)
				}
				onRequestDeleteChoice={(id, label) => {
					setDeleteTarget({ type: "choice", id, label })
					deleteModalRef.current?.showModal()
				}}
				onRequestDeleteEffect={(effectId, label) => {
					setDeleteTarget({ type: "effect", id: effectId, label })
					deleteModalRef.current?.showModal()
				}}
			/>

			<DeleteConfirmModal
				modalRef={deleteModalRef}
				deleteTarget={deleteTarget}
				isNew={isNew}
				onClose={() => setDeleteTarget(null)}
				onConfirmPendingDelete={() => {
					if (deleteTarget?.type === "choice" && isNew) {
						setPendingChoices((prev) => prev.filter((c) => c.clientId !== deleteTarget.id))
					}
					setDeleteTarget(null)
				}}
			/>
		</VStack>
	)
}
