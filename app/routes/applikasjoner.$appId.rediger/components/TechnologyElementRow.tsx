import { CheckmarkIcon, XMarkIcon } from "@navikt/aksel-icons"
import { BodyShort, Box, Button, HStack, Tag, Textarea, VStack } from "@navikt/ds-react"
import { useState } from "react"
import { Form } from "react-router"
import type { AppElement } from "../shared"

export function TechnologyElementRow({ element: el }: { element: AppElement }) {
	const [rejecting, setRejecting] = useState(false)

	const isAuto = el.source === "auto"
	const isConfirmed = !!el.confirmedAt
	const isRejected = !!el.rejectedAt
	const isPending = isAuto && !isConfirmed && !isRejected

	const variant = isRejected ? "neutral" : isConfirmed ? "success" : isPending ? "warning" : "alt1"

	return (
		<Box
			borderWidth="1"
			borderColor={isRejected ? "danger-subtle" : isPending ? "warning-subtle" : "neutral-subtle"}
			padding="space-8"
			borderRadius="8"
		>
			<VStack gap="space-4">
				<HStack gap="space-4" align="center" wrap>
					<Tag variant={variant} size="small">
						{el.name}
					</Tag>
					{isAuto && (
						<Tag variant="neutral" size="xsmall">
							Automatisk oppdaget
						</Tag>
					)}
					{isConfirmed && (
						<Tag variant="success" size="xsmall">
							Bekreftet{el.confirmedBy ? ` av ${el.confirmedBy}` : ""}
						</Tag>
					)}
					{isRejected && (
						<Tag variant="error" size="xsmall">
							Avvist{el.rejectedBy ? ` av ${el.rejectedBy}` : ""}
						</Tag>
					)}
					{!isAuto && (
						<Tag variant="info" size="xsmall">
							Manuelt lagt til
						</Tag>
					)}
				</HStack>

				{isRejected && el.rejectionReason && (
					<BodyShort size="small" style={{ color: "var(--ax-text-subtle)" }}>
						Begrunnelse: {el.rejectionReason}
					</BodyShort>
				)}

				<HStack gap="space-2" align="center">
					{isPending && (
						<>
							<Form method="post" style={{ display: "inline" }}>
								<input type="hidden" name="intent" value="confirmElement" />
								<input type="hidden" name="linkId" value={el.linkId} />
								<Button variant="primary" size="xsmall" type="submit" icon={<CheckmarkIcon aria-hidden />}>
									Bekreft
								</Button>
							</Form>
							<Button
								variant="danger"
								size="xsmall"
								onClick={() => setRejecting(true)}
								icon={<XMarkIcon aria-hidden />}
							>
								Avvis
							</Button>
						</>
					)}
					{isRejected && (
						<Form method="post" style={{ display: "inline" }}>
							<input type="hidden" name="intent" value="confirmElement" />
							<input type="hidden" name="linkId" value={el.linkId} />
							<Button variant="secondary" size="xsmall" type="submit">
								Angre avvisning og bekreft
							</Button>
						</Form>
					)}
					{isConfirmed && isAuto && (
						<Button variant="tertiary" size="xsmall" onClick={() => setRejecting(true)}>
							Avvis likevel
						</Button>
					)}
					<Form method="post" style={{ display: "inline" }}>
						<input type="hidden" name="intent" value="removeElement" />
						<input type="hidden" name="elementId" value={el.id} />
						<Button variant="tertiary-neutral" size="xsmall" type="submit">
							Fjern
						</Button>
					</Form>
				</HStack>

				{rejecting && (
					<Form method="post">
						<input type="hidden" name="intent" value="rejectElement" />
						<input type="hidden" name="linkId" value={el.linkId} />
						<VStack gap="space-4">
							<Textarea label="Begrunnelse for avvisning" name="reason" size="small" minRows={2} autoFocus />
							<HStack gap="space-2">
								<Button variant="danger" size="xsmall" type="submit">
									Avvis
								</Button>
								<Button variant="tertiary" size="xsmall" type="button" onClick={() => setRejecting(false)}>
									Avbryt
								</Button>
							</HStack>
						</VStack>
					</Form>
				)}
			</VStack>
		</Box>
	)
}
