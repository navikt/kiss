import { XMarkIcon } from "@navikt/aksel-icons"
import { BodyLong, Box, Button, Heading, HStack, Select, Tag } from "@navikt/ds-react"
import { Form } from "react-router"

export function TeamsSection({
	teams,
	availableTeams,
}: {
	teams: Array<{ teamId: string; teamName: string }>
	availableTeams: Array<{ id: string; name: string }>
}) {
	return (
		<Box>
			<Heading size="medium" level="3" spacing>
				Team
			</Heading>
			{teams.length > 0 ? (
				<HStack gap="space-4" wrap>
					{teams.map((t) => (
						<Form key={t.teamId} method="post" style={{ display: "inline" }}>
							<input type="hidden" name="intent" value="unlink-team" />
							<input type="hidden" name="devTeamId" value={t.teamId} />
							<Tag variant="info" size="small">
								{t.teamName}
								<Button
									variant="tertiary-neutral"
									size="xsmall"
									type="submit"
									icon={<XMarkIcon aria-hidden />}
									title={`Fjern ${t.teamName}`}
									aria-label={`Fjern ${t.teamName}`}
									style={{ marginLeft: "var(--ax-space-2)", marginRight: "calc(-1 * var(--ax-space-2))" }}
								/>
							</Tag>
						</Form>
					))}
				</HStack>
			) : (
				<BodyLong>Ikke tilknyttet noe utviklerteam.</BodyLong>
			)}
			{availableTeams.length > 0 && (
				<Form method="post" style={{ marginTop: "var(--ax-space-8)" }}>
					<input type="hidden" name="intent" value="link-team" />
					<HStack gap="space-2" align="end">
						<Select label="Legg til team" name="devTeamId" size="small">
							{availableTeams.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</Select>
						<Button variant="secondary" size="small" type="submit">
							Legg til
						</Button>
					</HStack>
				</Form>
			)}
		</Box>
	)
}
