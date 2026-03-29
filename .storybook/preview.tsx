import type { Preview } from "@storybook/react"
import "@navikt/ds-css/dist/index.css"
import "../app/styles/global.css"

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
	},
}

export default preview
