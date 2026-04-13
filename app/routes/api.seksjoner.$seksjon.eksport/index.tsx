import type { LoaderFunctionArgs } from "react-router"
import { getRoutine, getRoutinesForSection } from "~/db/queries/routines.server"
import { getRulesetDetail, getRulesetsForSection } from "~/db/queries/rulesets.server"
import { getChoiceEffects, getChoicesForQuestion, getSectionScreeningQuestions } from "~/db/queries/screening.server"
import { getSectionBySlug } from "~/db/queries/sections.server"
import { getAuthenticatedUser, requireUser } from "~/lib/auth.server"
import { getFrequencyLabel } from "~/lib/routine-frequencies"

export async function loader({ request, params }: LoaderFunctionArgs) {
	const user = await getAuthenticatedUser(request)
	requireUser(user)

	const { seksjon } = params
	if (!seksjon) throw new Response("Mangler seksjon", { status: 400 })

	const section = await getSectionBySlug(seksjon)
	if (!section) throw new Response("Seksjon ikke funnet", { status: 404 })

	const url = new URL(request.url)
	const type = url.searchParams.get("type")

	if (type === "screening") {
		return exportScreeningQuestions(section)
	}
	if (type === "rutiner") {
		return exportRoutines(section)
	}
	if (type === "regelsett") {
		return exportRulesets(section)
	}

	// Export all
	const [screening, routines, rulesets] = await Promise.all([
		buildScreeningExport(section.id),
		buildRoutinesExport(section.id),
		buildRulesetsExport(section.id),
	])

	const exportData = {
		eksportert: new Date().toISOString(),
		seksjon: section.name,
		innledendeSporsmal: screening,
		rutiner: routines,
		regelsett: rulesets,
	}

	return jsonDownload(exportData, `${seksjon}-eksport.json`)
}

async function buildScreeningExport(sectionId: string) {
	const questions = await getSectionScreeningQuestions(sectionId)
	return Promise.all(
		questions.map(async (q) => {
			const choices = await getChoicesForQuestion(q.id)
			const choicesWithEffects = await Promise.all(
				choices.map(async (c) => {
					const effects = await getChoiceEffects(c.id)
					return {
						navn: c.label,
						kreverKommentar: c.requiresComment,
						kreverLenke: c.requiresLink,
						effekter: effects.map((e) => ({
							kontroll: e.controlTextId,
							effekt: e.effect,
							kommentar: e.comment,
						})),
					}
				}),
			)
			return {
				sporsmal: q.questionText,
				beskrivelse: q.description,
				svartype: q.answerType,
				rekkefølge: q.displayOrder,
				valgmuligheter: choicesWithEffects,
			}
		}),
	)
}

async function buildRoutinesExport(sectionId: string) {
	const routineList = await getRoutinesForSection(sectionId)
	return Promise.all(
		routineList.map(async (r) => {
			const detail = await getRoutine(r.id)
			return {
				navn: r.name,
				beskrivelse: r.description,
				frekvens: getFrequencyLabel(r.frequency),
				ansvarligRolle: r.responsibleRole,
				teknologielementer: r.technologyElements.map((te) => te.name),
				tilknyttedeKrav:
					detail?.controls.map((c) => ({
						kontrollId: c.controlId,
						navn: c.name,
					})) ?? [],
				innledendeSporsmal:
					detail?.screeningQuestions.map((sq) => ({
						sporsmalId: sq.questionId,
						svarverdi: sq.choiceValue,
					})) ?? [],
				antallGjennomganger: r.reviewCount,
			}
		}),
	)
}

async function buildRulesetsExport(sectionId: string) {
	const rulesetList = await getRulesetsForSection(sectionId)
	return Promise.all(
		rulesetList.map(async (rs) => {
			const detail = await getRulesetDetail(rs.id)
			return {
				navn: rs.name,
				beskrivelse: rs.description,
				frekvens: getFrequencyLabel(rs.frequency),
				ansvarligRolle: rs.responsibleRole,
				ansvarligNavn: rs.responsibleName,
				status: rs.status,
				godkjenningsstatus: rs.approvalStatus,
				tilknyttedeKrav:
					detail?.controls.map((c) => ({
						kontrollId: c.controlId,
						navn: c.shortTitle,
					})) ?? [],
				sisteGodkjenning: rs.lastApproval
					? {
							gyldigFra: rs.lastApproval.validFrom,
							gyldigTil: rs.lastApproval.validUntil,
						}
					: null,
			}
		}),
	)
}

async function exportScreeningQuestions(section: { id: string; slug: string; name: string }) {
	const data = await buildScreeningExport(section.id)
	return jsonDownload(
		{
			eksportert: new Date().toISOString(),
			seksjon: section.name,
			innledendeSporsmal: data,
		},
		`${section.slug}-screening.json`,
	)
}

async function exportRoutines(section: { id: string; slug: string; name: string }) {
	const data = await buildRoutinesExport(section.id)
	return jsonDownload(
		{
			eksportert: new Date().toISOString(),
			seksjon: section.name,
			rutiner: data,
		},
		`${section.slug}-rutiner.json`,
	)
}

async function exportRulesets(section: { id: string; slug: string; name: string }) {
	const data = await buildRulesetsExport(section.id)
	return jsonDownload(
		{
			eksportert: new Date().toISOString(),
			seksjon: section.name,
			regelsett: data,
		},
		`${section.slug}-regelsett.json`,
	)
}

function jsonDownload(data: unknown, filename: string) {
	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": `attachment; filename="${filename}"`,
		},
	})
}
