import { Box, Detail, Heading, HStack, Tag, VStack } from "@navikt/ds-react"

function getCoverageVariant(percent: number | null): "success" | "warning" | "error" | "neutral" {
	if (percent === null) return "neutral"
	if (percent >= 80) return "success"
	if (percent >= 60) return "warning"
	return "error"
}

export function CoverageCard({
	title,
	percent,
	numerator,
	denominator,
	details,
}: {
	title: string
	percent: number | null
	numerator: number | null
	denominator: number | null
	details?: Array<{ label: string; value: number | null }>
}) {
	const variant = getCoverageVariant(percent)

	return (
		<Box padding="space-16" borderRadius="8" borderColor="neutral-subtle" borderWidth="1">
			<VStack gap="space-8">
				<Heading size="xsmall">{title}</Heading>
				{percent !== null ? (
					<>
						<div
							style={{
								height: "8px",
								background: "var(--ax-bg-neutral-moderate)",
								borderRadius: "var(--ax-radius-4)",
								overflow: "hidden",
							}}
						>
							<div
								style={{
									height: "100%",
									width: `${Math.min(100, percent)}%`,
									background:
										variant === "success"
											? "var(--ax-bg-positive-strong)"
											: variant === "warning"
												? "var(--ax-bg-warning-strong)"
												: "var(--ax-bg-danger-strong)",
									borderRadius: "var(--ax-radius-4)",
									transition: "width 0.3s ease",
								}}
								role="progressbar"
								aria-valuenow={percent}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-label={`${title}: ${Math.round(percent)}%`}
							/>
						</div>
						<HStack gap="space-4" align="center">
							<Tag variant={variant} size="small">
								{Math.round(percent)}%
							</Tag>
							{numerator !== null && denominator !== null && (
								<Detail>
									{numerator} av {denominator}
								</Detail>
							)}
						</HStack>
					</>
				) : (
					<Tag variant="neutral" size="small">
						Ingen data
					</Tag>
				)}
				{details && details.length > 0 && (
					<VStack gap="space-2">
						{details.map((d) => (
							<HStack key={d.label} gap="space-4" justify="space-between">
								<Detail>{d.label}</Detail>
								<Detail>{d.value ?? "–"}</Detail>
							</HStack>
						))}
					</VStack>
				)}
			</VStack>
		</Box>
	)
}
