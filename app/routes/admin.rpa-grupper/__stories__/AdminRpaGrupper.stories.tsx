import type { Meta, StoryObj } from "@storybook/react"
import { mockAdminRpaGrupperData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import AdminRpaGrupper from "../index"

const meta = {
	title: "Sider/Admin/RPA-grupper",
	component: AdminRpaGrupper,
} satisfies Meta<typeof AdminRpaGrupper>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Med grupper og audit log",
	render: () => renderWithLoader(AdminRpaGrupper, mockAdminRpaGrupperData(), "/admin/rpa-grupper"),
}

export const Tomt: Story = {
	name: "Ingen grupper",
	render: () =>
		renderWithLoader(AdminRpaGrupper, mockAdminRpaGrupperData({ groups: [], auditLog: [] }), "/admin/rpa-grupper"),
}
