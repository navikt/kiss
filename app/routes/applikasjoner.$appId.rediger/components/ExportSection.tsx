import { DownloadIcon } from "@navikt/aksel-icons"
import { Box, Button, Heading } from "@navikt/ds-react"

export function ExportSection({ appId }: { appId: string }) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Eksport
			</Heading>
			<Button
				as="a"
				href={`/api/applikasjoner/${appId}/export-xlsx`}
				variant="secondary"
				size="small"
				icon={<DownloadIcon aria-hidden />}
			>
				Last ned compliance-rapport (XLSX)
			</Button>
		</Box>
	)
}
