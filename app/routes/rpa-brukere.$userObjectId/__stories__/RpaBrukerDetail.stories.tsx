import type { Meta, StoryObj } from "@storybook/react"
import { mockAdminRpaRobotDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import RpaBrukerDetail from "../index"

const meta = {
	title: "Sider/RPA-brukere/Brukerdetalj",
	component: RpaBrukerDetail,
} satisfies Meta<typeof RpaBrukerDetail>
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoader(RpaBrukerDetail, mockAdminRpaRobotDetailData(), "/rpa-brukere/user-obj-1"),
}

export const Deaktivert: Story = {
	render: () =>
		renderWithLoader(
			RpaBrukerDetail,
			mockAdminRpaRobotDetailData({
				member: {
					displayName: "RPA Arkiv Bot",
					userPrincipalName: "rpa-arkiv@nav.no",
					accountEnabled: false,
					userObjectId: "user-obj-2",
					rpaGroups: [{ id: "rpa-g-2", groupName: "Arkiv-RPA-Gruppe" }],
				},
			}),
			"/rpa-brukere/user-obj-2",
		),
}
