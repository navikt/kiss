import type { Preview } from "@storybook/react"
import "@navikt/ds-css/dist/index.css"
import "../app/styles/global.css"

const preview: Preview = {
	parameters: {
		viewport: {
			options: {
				mobile: {
					name: "Mobil (375px)",
					styles: { width: "375px", height: "667px" },
				},
				tablet: {
					name: "Nettbrett (768px)",
					styles: { width: "768px", height: "1024px" },
				},
				desktop: {
					name: "Desktop (1280px)",
					styles: { width: "1280px", height: "800px" },
				},
			},
		},
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
	},
}

export default preview
