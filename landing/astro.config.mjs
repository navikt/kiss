import { defineConfig } from "astro/config"

// Base alltid med ledende og etterfølgende skråstrek, overstyrbar for senere
// migrering til eget domene (sett BASE_PATH=/ for rot).
const base = (process.env.BASE_PATH ?? "/kiss").replace(/^\/*/, "/").replace(/\/*$/, "/")

export default defineConfig({
	site: "https://navikt.github.io",
	base,
	trailingSlash: "ignore",
})
