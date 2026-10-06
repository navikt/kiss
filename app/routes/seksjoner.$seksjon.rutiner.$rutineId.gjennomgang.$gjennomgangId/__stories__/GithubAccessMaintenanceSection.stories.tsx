import type { Meta, StoryObj } from "@storybook/react"
import { createRoutesStub } from "react-router"
import type { GithubAccessSubject } from "~/lib/github-access-staged-data"
import {
	GithubAccessMaintenanceSection,
	type GithubAccessSubjectWithIdentity,
} from "../components/activities/GithubAccessMaintenanceSection"
import type { ActivityProp } from "../components/shared"

function withRouterStub(children: React.ReactNode) {
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => children,
			action: async () => ({ success: true }),
		},
	])
	return <Stub initialEntries={["/"]} />
}

const meta: Meta<typeof GithubAccessMaintenanceSection> = {
	title: "Sider/Seksjoner/Rutiner/Gjennomgang/Github-tilgangsgjennomgang",
	component: GithubAccessMaintenanceSection,
	parameters: { layout: "padded" },
	decorators: [(Story) => withRouterStub(<Story />)],
}

export default meta
type Story = StoryObj<typeof GithubAccessMaintenanceSection>

const baseActivity: ActivityProp = {
	id: "activity-1",
	type: "github_access_maintenance",
	status: "pending",
	completedAt: null,
	createdAt: "2026-09-01T08:00:00Z",
	changes: [],
}

const subjects: GithubAccessSubjectWithIdentity[] = [
	{
		username: "glad-fjord",
		displayName: "Glad Fjord",
		navIdent: "Z990001",
		highestPermission: "admin",
		directPermission: "admin",
		viaTeams: [],
		isNew: false,
		isGone: false,
		markedForRemoval: false,
		removalMarkedBy: null,
		removalMarkedAt: null,
		permissionAdjustmentRequested: false,
		targetPermission: null,
		permissionAdjustmentMarkedBy: null,
		permissionAdjustmentMarkedAt: null,
	},
	{
		username: "rask-elv",
		highestPermission: "push",
		directPermission: null,
		viaTeams: [{ teamSlug: "pensjon-saksbehandling", teamName: "pensjon-saksbehandling", permission: "push" }],
		isNew: false,
		isGone: false,
		markedForRemoval: false,
		removalMarkedBy: null,
		removalMarkedAt: null,
		permissionAdjustmentRequested: false,
		targetPermission: null,
		permissionAdjustmentMarkedBy: null,
		permissionAdjustmentMarkedAt: null,
	},
	{
		username: "stille-skog",
		highestPermission: "maintain",
		directPermission: null,
		viaTeams: [
			{ teamSlug: "teampensjon", teamName: "teampensjon", permission: "maintain" },
			{ teamSlug: "plattform-sikkerhet", teamName: "plattform-sikkerhet", permission: "push" },
			{ teamSlug: "arkitektur-guild", teamName: "arkitektur-guild", permission: "pull" },
		],
		isNew: true,
		isGone: false,
		markedForRemoval: false,
		removalMarkedBy: null,
		removalMarkedAt: null,
		permissionAdjustmentRequested: false,
		targetPermission: null,
		permissionAdjustmentMarkedBy: null,
		permissionAdjustmentMarkedAt: null,
	},
	{
		username: "modig-bjork",
		highestPermission: "admin",
		directPermission: "admin",
		viaTeams: [],
		isNew: false,
		isGone: false,
		markedForRemoval: false,
		removalMarkedBy: null,
		removalMarkedAt: null,
		permissionAdjustmentRequested: false,
		targetPermission: null,
		permissionAdjustmentMarkedBy: null,
		permissionAdjustmentMarkedAt: null,
	},
	{
		username: "tidligere-kollega",
		highestPermission: "push",
		directPermission: "push",
		viaTeams: [],
		isNew: false,
		isGone: true,
		markedForRemoval: false,
		removalMarkedBy: null,
		removalMarkedAt: null,
		permissionAdjustmentRequested: false,
		targetPermission: null,
		permissionAdjustmentMarkedBy: null,
		permissionAdjustmentMarkedAt: null,
	},
]

export const PagaendeGjennomgang: Story = {
	name: "Pågående gjennomgang (ikke bekreftet)",
	args: {
		activity: baseActivity,
		reviewId: "review-1",
		gitRepository: "navikt/pensjon-saksbehandling",
		subjects,
		confirmedBy: null,
		confirmedAt: null,
		isDraft: true,
	},
}

export const Bekreftet: Story = {
	name: "Bekreftet (klar for fullføring)",
	args: {
		activity: baseActivity,
		reviewId: "review-1",
		gitRepository: "navikt/pensjon-saksbehandling",
		subjects,
		confirmedBy: "Z990001",
		confirmedAt: "2026-09-10T09:10:00Z",
		confirmedByName: "Glad Fjord",
		isDraft: true,
	},
}

export const FullfortAktivitet: Story = {
	name: "Fullført aktivitet (read-only)",
	args: {
		activity: { ...baseActivity, status: "completed", completedAt: "2026-09-10T09:10:00Z" },
		reviewId: "review-1",
		gitRepository: "navikt/pensjon-saksbehandling",
		subjects,
		confirmedBy: "Z990001",
		confirmedAt: "2026-09-10T09:10:00Z",
		confirmedByName: "Glad Fjord",
		isDraft: false,
	},
}

export const IngenTilganger: Story = {
	name: "Ingen tilganger",
	args: {
		activity: baseActivity,
		reviewId: "review-1",
		gitRepository: "navikt/nytt-repo",
		subjects: [],
		confirmedBy: null,
		confirmedAt: null,
		isDraft: true,
	},
}

export const MerketForFjerning: Story = {
	name: "Merket for fjerning (oppfølgingspunkt opprettes ved fullføring)",
	args: {
		activity: baseActivity,
		reviewId: "review-1",
		gitRepository: "navikt/pensjon-saksbehandling",
		subjects: [
			...subjects.filter((s) => !s.isGone),
			{
				username: "sluttet-utvikler",
				highestPermission: "push",
				directPermission: null,
				viaTeams: [{ teamSlug: "teampensjon", teamName: "teampensjon", permission: "push" }],
				isNew: false,
				isGone: false,
				markedForRemoval: true,
				removalMarkedBy: "Z990001",
				removalMarkedAt: "2026-09-10",
				permissionAdjustmentRequested: false,
				targetPermission: null,
				permissionAdjustmentMarkedBy: null,
				permissionAdjustmentMarkedAt: null,
			},
			...subjects.filter((s) => s.isGone),
		],
		confirmedBy: null,
		confirmedAt: null,
		isDraft: true,
	},
}

export const MerketForJustering: Story = {
	name: "Merket for justering av tilgangsnivå (oppfølgingspunkt opprettes ved fullføring)",
	args: {
		activity: baseActivity,
		reviewId: "review-1",
		gitRepository: "navikt/pensjon-saksbehandling",
		subjects: [
			...subjects.filter((s) => !s.isGone),
			{
				username: "endret-rolle",
				highestPermission: "admin",
				directPermission: "admin",
				viaTeams: [],
				isNew: false,
				isGone: false,
				markedForRemoval: false,
				removalMarkedBy: null,
				removalMarkedAt: null,
				permissionAdjustmentRequested: true,
				targetPermission: "push",
				permissionAdjustmentMarkedBy: "Z990001",
				permissionAdjustmentMarkedAt: "2026-09-10",
			},
			...subjects.filter((s) => s.isGone),
		],
		confirmedBy: null,
		confirmedAt: null,
		isDraft: true,
	},
}

const NAMES = [
	"glad-fjord",
	"rask-elv",
	"stille-skog",
	"modig-bjork",
	"varm-solstraale",
	"klok-ugle",
	"blid-maane",
	"trygg-havn",
	"lys-stjerne",
	"sterk-bjorn",
	"snill-rev",
	"kvikk-hare",
	"stolt-orn",
	"mild-bris",
	"tapper-ulv",
	"fredelig-innsjo",
	"aapen-slette",
	"varsom-gaupe",
	"ivrig-elg",
	"rolig-fjell",
]

const manySubjects: GithubAccessSubject[] = NAMES.map((username, i) => ({
	username,
	highestPermission: i % 5 === 0 ? "admin" : i % 3 === 0 ? "maintain" : "push",
	directPermission: i % 4 === 0 ? "push" : null,
	viaTeams:
		i % 4 === 0 ? [] : [{ teamSlug: "pensjon-saksbehandling", teamName: "pensjon-saksbehandling", permission: "push" }],
	isNew: i % 6 === 0,
	isGone: false,
	markedForRemoval: false,
	removalMarkedBy: null,
	removalMarkedAt: null,
	permissionAdjustmentRequested: false,
	targetPermission: null,
	permissionAdjustmentMarkedBy: null,
	permissionAdjustmentMarkedAt: null,
}))

export const LangListe: Story = {
	name: "Lang liste — samlet bekreftelse",
	args: {
		activity: baseActivity,
		reviewId: "review-1",
		gitRepository: "navikt/pensjon-saksbehandling",
		subjects: manySubjects,
		confirmedBy: null,
		confirmedAt: null,
		isDraft: true,
	},
}
