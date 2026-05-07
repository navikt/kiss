import { BodyShort, Heading, HStack, Radio, RadioGroup, Select, Tag, Textarea, VStack } from "@navikt/ds-react"
import { useState } from "react"
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

export function EconomySystemSection({ classification }: { classification: EconomyClassificationData }) {
	const [isEconomy, setIsEconomy] = useState<string | undefined>(
		classification ? (classification.isEconomySystem ? "ja" : "nei") : undefined,
	)
	const [type, setType] = useState<string>(classification?.economySystemType ?? "")
	const [justification, setJustification] = useState(classification?.justification ?? "")

	const isExpired =
		classification?.isExpired ?? (classification?.validUntil ? new Date(classification.validUntil) < new Date() : false)

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
								? `Økonomisystem${classification.economySystemType ? ` (${economySystemTypeLabels[classification.economySystemType as keyof typeof economySystemTypeLabels]})` : ""}`
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

			<VStack gap="space-4">
				<Heading size="xsmall" level="4">
					{classification ? "Oppdater klassifisering" : "Klassifiser applikasjonen"}
				</Heading>

				<RadioGroup
					id="eco-radio"
					legend="Er dette et system underlagt økonomireglementet?"
					size="small"
					value={isEconomy ?? ""}
					onChange={(val) => setIsEconomy(val)}
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
						onChange={(e) => setType(e.target.value)}
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
					onChange={(e) => setJustification(e.target.value)}
					minRows={3}
				/>
			</VStack>
		</VStack>
	)
}
