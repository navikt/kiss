import type { Meta, StoryObj } from "@storybook/react"
import { mockAdminRpaRobotDetailData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import AdminRpaRobotDetail from "../index"

const meta = {
	title: "Sider/Admin/RPA-grupper/Robotbruker-detalj",
	component: AdminRpaRobotDetail,
} satisfies Meta<typeof AdminRpaRobotDetail>
export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
	render: () => renderWithLoader(AdminRpaRobotDetail, mockAdminRpaRobotDetailData(), "/admin/rpa-grupper/user-obj-1"),
}

export const Deaktivert: Story = {
	render: () =>
		renderWithLoader(
			AdminRpaRobotDetail,
			mockAdminRpaRobotDetailData({
				member: {
					displayName: "RPA Arkiv Bot",
					userPrincipalName: "rpa-arkiv@nav.no",
					accountEnabled: false,
					userObjectId: "user-obj-2",
					rpaGroups: [{ id: "rpa-g-2", groupName: "Arkiv-RPA-Gruppe" }],
				},
			}),
			"/admin/rpa-grupper/user-obj-2",
		),
}
