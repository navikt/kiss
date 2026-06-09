import { DownloadIcon } from "@navikt/aksel-icons"
import { Button, Heading, VStack } from "@navikt/ds-react"

interface Props {
	seksjon: string
}

export function DataTab({ seksjon }: Props) {
	return (
		<VStack gap="space-8">
			<VStack gap="space-4">
				<Heading size="medium" level="3">
					Eksport
				</Heading>
				<div>
					<Button
						as="a"
						href={`/api/seksjoner/${seksjon}/eksport`}
						variant="secondary"
						size="small"
						icon={<DownloadIcon aria-hidden />}
					>
						Eksporter alt
					</Button>
				</div>
			</VStack>
		</VStack>
	)
}
