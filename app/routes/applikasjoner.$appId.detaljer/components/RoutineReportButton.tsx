import { DownloadIcon } from "@navikt/aksel-icons"
import { Button } from "@navikt/ds-react"
import { useEffect, useRef } from "react"
import { useFetcher } from "react-router"
import type { action } from "../action.server"

// useFetcher brukes slik at handlingen ikke navigerer bort fra Rutiner-fanen.
export function RoutineReportButton({ routineId }: { routineId: string }) {
	const fetcher = useFetcher<typeof action>()
	const isGenerating = fetcher.state !== "idle"
	const lastHandledReportId = useRef<string | null>(null)

	useEffect(() => {
		const result = fetcher.data as { success?: boolean; reportId?: string } | undefined
		if (result?.success && result.reportId && result.reportId !== lastHandledReportId.current) {
			lastHandledReportId.current = result.reportId
			window.open(`/api/rapporter/${result.reportId}/pdf?download=true`, "_blank", "noopener")
		}
	}, [fetcher.data])

	return (
		<fetcher.Form method="post">
			<input type="hidden" name="intent" value="generate-routine-report" />
			<input type="hidden" name="routineId" value={routineId} />
			<Button
				type="submit"
				variant="tertiary"
				size="xsmall"
				icon={<DownloadIcon aria-hidden />}
				loading={isGenerating}
				style={{ whiteSpace: "nowrap" }}
			>
				Rapport
			</Button>
			{fetcher.data && !fetcher.data.success && fetcher.data.error && (
				<span role="alert" style={{ display: "block", fontSize: "0.75rem", color: "var(--ax-text-danger)" }}>
					{fetcher.data.error}
				</span>
			)}
		</fetcher.Form>
	)
}
