import { cleanup, render, screen } from "@testing-library/react"
import { createRoutesStub } from "react-router"
import { afterEach, expect, it } from "vitest"
import { OracleEvidenceSection } from "../components/OracleEvidenceSection"

afterEach(cleanup)

it("shows only removal for configurations missing from the Oracle API", () => {
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => (
				<OracleEvidenceSection
					oracleInstances={[]}
					availableOracleInstances={[]}
					unavailableOracleInstances={[{ id: "config-1", instanceId: "missing-instance" }]}
				/>
			),
		},
	])

	render(<Stub />)

	expect(screen.getByText("MISSING-INSTANCE")).toBeTruthy()
	expect(screen.getByRole("button", { name: "Fjern Oracle-instans MISSING-INSTANCE" })).toBeTruthy()
	expect(screen.queryByRole("button", { name: "Hent bevis" })).toBeNull()
	expect(screen.queryByRole("button", { name: "Ta med i rapport" })).toBeNull()
	expect(
		screen.getByText("Instansen finnes ikke lenger i Oracle-oversikten. Konfigurasjonen kan fjernes."),
	).toBeTruthy()
})

it("distinguishes removal buttons for configured and missing instances", () => {
	const Stub = createRoutesStub([
		{
			path: "/",
			Component: () => (
				<OracleEvidenceSection
					oracleInstances={[
						{ id: "config-1", instanceId: "active-instance", includeInReport: false, latestSnapshot: null },
					]}
					availableOracleInstances={[]}
					unavailableOracleInstances={[
						{ id: "config-2", instanceId: "missing-instance-1" },
						{ id: "config-3", instanceId: "missing-instance-2" },
					]}
				/>
			),
		},
	])

	render(<Stub />)

	for (const instanceId of ["ACTIVE-INSTANCE", "MISSING-INSTANCE-1", "MISSING-INSTANCE-2"]) {
		const button = screen.getByRole("button", { name: `Fjern Oracle-instans ${instanceId}` })
		expect(button.textContent).toBe("Fjern")
	}
	expect(screen.queryByRole("button", { name: "Fjern" })).toBeNull()
})
