import { Button, Modal, Textarea } from "@navikt/ds-react"
import { useRef, useState } from "react"
import { useSubmit } from "react-router"
import { AuthorizedAppsPanel } from "../components/AuthorizedAppsPanel"
import type { AccessPolicyRule } from "../shared"

export function AutoriserteAppsTab({
	accessPolicyRules,
	knownApps,
	acknowledgments,
}: {
	accessPolicyRules: AccessPolicyRule[]
	knownApps: Record<string, { status: string; appId?: string }>
	acknowledgments: Record<string, { comment: string; acknowledgedBy: string; acknowledgedAt: string }>
}) {
	const submit = useSubmit()
	const [ackTarget, setAckTarget] = useState<string | null>(null)
	const [ackComment, setAckComment] = useState("")
	const ackModalRef = useRef<HTMLDialogElement>(null)

	return (
		<>
			<AuthorizedAppsPanel
				accessPolicyRules={accessPolicyRules}
				knownApps={knownApps}
				acknowledgments={acknowledgments}
				submit={submit}
				setAckTarget={setAckTarget}
				setAckComment={setAckComment}
				ackModalRef={ackModalRef}
			/>

			<Modal
				ref={ackModalRef}
				header={{ heading: `Kvitter ut ${ackTarget ?? ""}` }}
				onClose={() => {
					setAckTarget(null)
					setAckComment("")
				}}
			>
				<Modal.Body>
					<Textarea
						label="Kommentar (obligatorisk)"
						description="Beskriv hvorfor denne applikasjonen er reell selv om den er ukjent i KISS"
						value={ackComment}
						onChange={(e) => setAckComment(e.target.value)}
						minRows={3}
					/>
				</Modal.Body>
				<Modal.Footer>
					<Button
						onClick={() => {
							if (!ackTarget || !ackComment.trim()) return
							submit({ intent: "acknowledge-app", ruleApplication: ackTarget, comment: ackComment }, { method: "POST" })
							ackModalRef.current?.close()
							setAckTarget(null)
							setAckComment("")
						}}
						disabled={!ackComment.trim()}
					>
						Bekreft
					</Button>
					<Button
						variant="secondary"
						onClick={() => {
							ackModalRef.current?.close()
							setAckTarget(null)
							setAckComment("")
						}}
					>
						Avbryt
					</Button>
				</Modal.Footer>
			</Modal>
		</>
	)
}
