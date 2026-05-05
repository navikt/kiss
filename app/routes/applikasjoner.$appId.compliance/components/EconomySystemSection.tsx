import {
	BodyShort,
	Button,
	ErrorSummary,
	Heading,
	HStack,
	Radio,
	RadioGroup,
	Select,
	Tag,
	Textarea,
	VStack,
} from "@navikt/ds-react"
import { useEffect, useRef, useState } from "react"
import { Form } from "react-router"
import { economySystemTypeEnum, economySystemTypeLabels } from "~/db/schema/applications"
import styles from "./wizard.module.css"

export type EconomyClassificationData = {
	id: string
	isEconomySystem: boolean
	economySystemType: string | null
	justification: string
	validFrom: string
	validUntil: string
	isExpired?: boolean
} | null

export function EconomySystemSection({
	classification,
	questionId,
	confirmed,
}: {
	classification: EconomyClassificationData
	questionId: string
	confirmed: boolean
}) {
	const [isEconomy, setIsEconomy] = useState<string | undefined>(
		classification ? (classification.isEconomySystem ? "ja" : "nei") : undefined,
	)
	const [type, setType] = useState<string>(classification?.economySystemType ?? "")
	const [justification, setJustification] = useState(classification?.justification ?? "")
	const [errors, setErrors] = useState<Array<{ message: string; href: string }>>([])
	const errorRef = useRef<HTMLDivElement>(null)

	const isExpired =
		classification?.isExpired ?? (classification?.validUntil ? new Date(classification.validUntil) < new Date() : false)

	useEffect(() => {
		if (errors.length > 0) {
			errorRef.current?.focus()
		}
	}, [errors])

	function validate(): Array<{ message: string; href: string }> {
		const errs: Array<{ message: string; href: string }> = []
		if (!isEconomy) errs.push({ message: "Du må velge om applikasjonen er et økonomisystem", href: "#eco-radio" })
		if (isEconomy === "ja" && !type) errs.push({ message: "Du må velge type økonomisystem", href: "#eco-type" })
		if (!justification.trim()) errs.push({ message: "Begrunnelse er påkrevd", href: "#eco-justification" })
		return errs
	}

	return (
		<VStack gap="space-6">
			{classification && (
				<div className={styles.currentClassification}>
					<Heading size="xsmall" level="4">
						Gjeldende klassifisering
					</Heading>
					<HStack gap="space-4" align="center">
						<Tag variant={classification.isEconomySystem ? "warning" : "neutral"} size="small">
							{classification.isEconomySystem
								? `Økonomisystem (${economySystemTypeLabels[classification.economySystemType as keyof typeof economySystemTypeLabels]})`
								: "Ikke økonomisystem"}
						</Tag>
						{isExpired && (
							<Tag variant="error" size="xsmall">
								Utløpt – trenger revisjon
							</Tag>
						)}
						{!isExpired && (
							<BodyShort size="small" textColor="subtle">
								Gyldig til {new Date(classification.validUntil).toLocaleDateString("nb-NO")}
							</BodyShort>
						)}
					</HStack>
					<BodyShort size="small">{classification.justification}</BodyShort>
				</div>
			)}

			{errors.length > 0 && (
				<ErrorSummary ref={errorRef} heading="Du må fylle ut følgende før du kan lagre:">
					{errors.map((err) => (
						<ErrorSummary.Item key={err.href} href={err.href}>
							{err.message}
						</ErrorSummary.Item>
					))}
				</ErrorSummary>
			)}

			<Form
				method="post"
				onSubmit={(e) => {
					const validationErrors = validate()
					if (validationErrors.length > 0) {
						e.preventDefault()
						setErrors(validationErrors)
					} else {
						setErrors([])
					}
				}}
			>
				<input type="hidden" name="intent" value="save-economy-classification" />
				<input type="hidden" name="questionId" value={questionId} />
				<VStack gap="space-4">
					<Heading size="xsmall" level="4">
						{classification ? "Oppdater klassifisering" : "Klassifiser applikasjonen"}
					</Heading>

					<RadioGroup
						id="eco-radio"
						legend="Er dette et system underlagt økonomireglementet?"
						size="small"
						value={isEconomy ?? ""}
						onChange={(val) => {
							setIsEconomy(val)
							setErrors([])
						}}
					>
						<Radio value="ja">Ja</Radio>
						<Radio value="nei">Nei</Radio>
					</RadioGroup>

					{isEconomy === "ja" && (
						<Select
							id="eco-type"
							label="Type økonomisystem"
							size="small"
							name="economySystemType"
							value={type}
							onChange={(e) => {
								setType(e.target.value)
								setErrors([])
							}}
						>
							<option value="">Velg type...</option>
							{economySystemTypeEnum.map((t) => (
								<option key={t} value={t}>
									{economySystemTypeLabels[t]}
								</option>
							))}
						</Select>
					)}

					<input type="hidden" name="isEconomySystem" value={isEconomy ?? ""} />

					<Textarea
						id="eco-justification"
						label="Begrunnelse"
						description="Beskriv kort hvorfor applikasjonen er/ikke er et økonomisystem"
						size="small"
						name="justification"
						value={justification}
						onChange={(e) => {
							setJustification(e.target.value)
							setErrors([])
						}}
						minRows={3}
					/>

					<HStack gap="space-4" align="center" justify="end">
						{confirmed && !isExpired && (
							<Tag variant="success" size="xsmall">
								✓ Bekreftet
							</Tag>
						)}
						<Button type="submit" size="small" variant={confirmed && !isExpired ? "secondary-neutral" : "primary"}>
							{classification ? "Oppdater og bekreft" : "Lagre og bekreft"}
						</Button>
					</HStack>
				</VStack>
			</Form>
		</VStack>
	)
}
