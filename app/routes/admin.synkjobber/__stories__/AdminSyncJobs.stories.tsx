import type { Meta, StoryObj } from "@storybook/react"
import { renderWithLoader } from "@storybook-mocks/router"
import { SYNC_JOB_TYPES } from "~/lib/sync-job-types"
import AdminSyncJobs from "../index"

const meta = {
	title: "Sider/Admin/Synkjobber",
	component: AdminSyncJobs,
} satisfies Meta<typeof AdminSyncJobs>
export default meta
type Story = StoryObj<typeof meta>

const mockSyncJobs = [
	{
		id: "job-1",
		jobType: SYNC_JOB_TYPES.NAIS_FULL_SYNC,
		state: "completed" as const,
		createdAt: "2026-05-14T14:30:00.000Z",
		message: "Synkronisering fullført",
		error: null,
	},
	{
		id: "job-2",
		jobType: SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
		state: "running" as const,
		createdAt: "2026-05-14T14:35:00.000Z",
		message: "Synkronisering pågår",
		error: null,
	},
	{
		id: "job-3",
		jobType: SYNC_JOB_TYPES.NAIS_SYNC_TEAMS,
		state: "failed" as const,
		createdAt: "2026-05-14T14:20:00.000Z",
		message: "Synkronisering feilet",
		error: "API timeout etter 30s",
	},
	{
		id: "job-4",
		jobType: SYNC_JOB_TYPES.NAIS_SYNC_APPS,
		state: "pending" as const,
		createdAt: "2026-05-14T14:10:00.000Z",
		message: "Venter på start",
		error: null,
	},
	{
		id: "job-5",
		jobType: SYNC_JOB_TYPES.RPA_GROUP_MEMBER_SYNC,
		state: "skipped" as const,
		createdAt: "2026-05-14T13:50:00.000Z",
		message: "RPA-synk var allerede i gang",
		error: null,
	},
]

export const MedJobber: Story = {
	name: "Med synkjobber i ulike statuser",
	render: () =>
		renderWithLoader(AdminSyncJobs, {
			syncJobs: mockSyncJobs,
			stateFilter: "",
			jobTypeFilter: "",
		}),
}

export const Tom: Story = {
	name: "Ingen synkjobber",
	render: () =>
		renderWithLoader(AdminSyncJobs, {
			syncJobs: [],
			stateFilter: "",
			jobTypeFilter: "",
		}),
}

export const FiltreringPaStatus: Story = {
	name: "Filtrert på status Fullført",
	render: () =>
		renderWithLoader(AdminSyncJobs, {
			syncJobs: mockSyncJobs.filter((j) => j.state === "completed"),
			stateFilter: "completed",
			jobTypeFilter: "",
		}),
}

export const FiltreringPaJobType: Story = {
	name: "Filtrert på NAIS-synk",
	render: () =>
		renderWithLoader(AdminSyncJobs, {
			syncJobs: mockSyncJobs.filter((j) => j.jobType.startsWith("nais_")),
			stateFilter: "",
			jobTypeFilter: SYNC_JOB_TYPES.NAIS_FULL_SYNC,
		}),
}

export const KunFeiledeJobber: Story = {
	name: "Kun feildede jobber",
	render: () =>
		renderWithLoader(AdminSyncJobs, {
			syncJobs: mockSyncJobs.filter((j) => j.state === "failed"),
			stateFilter: "failed",
			jobTypeFilter: "",
		}),
}
