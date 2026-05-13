import type { Meta, StoryObj } from "@storybook/react"
import { mockRpaSectionData } from "@storybook-mocks/data"
import { renderWithLoader } from "@storybook-mocks/router"
import RpaBrukere from "../index"

const meta = {
	title: "Sider/Seksjoner/RPA-brukere",
	component: RpaBrukere,
} satisfies Meta<typeof RpaBrukere>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
	name: "Med RPA-brukere (inkl. dedup og null-verdier)",
	render: () => renderWithLoader(RpaBrukere, mockRpaSectionData(), "/seksjoner/pensjon-og-ufore/rpa-brukere"),
}

export const Tomt: Story = {
	name: "Ingen RPA-brukere",
	render: () =>
		renderWithLoader(RpaBrukere, mockRpaSectionData({ rpaUsers: [] }), "/seksjoner/pensjon-og-ufore/rpa-brukere"),
}
