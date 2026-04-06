import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { COMPLIANCE_STATUSES, type ComplianceStatus, statusLabels } from "~/lib/compliance-status"
import { ComplianceComment, ComplianceStatusBadge } from "../ComplianceStatus"

afterEach(() => cleanup())

describe("ComplianceStatusBadge", () => {
	const statuses: ComplianceStatus[] = [...COMPLIANCE_STATUSES]

	it.each(statuses)("renders correct label for status '%s'", (status) => {
		render(<ComplianceStatusBadge status={status} />)
		expect(screen.getByText(statusLabels[status])).toBeDefined()
	})

	it("renders a Tag element for each status", () => {
		for (const status of statuses) {
			const { unmount } = render(<ComplianceStatusBadge status={status} />)
			expect(screen.getByText(statusLabels[status])).toBeDefined()
			unmount()
		}
	})
})

describe("ComplianceComment", () => {
	it("renders plain text without links", () => {
		render(<ComplianceComment comment="This is a plain comment" />)
		const paragraph = screen.getByText("This is a plain comment")
		expect(paragraph).toBeDefined()
		expect(document.querySelector("a")).toBeNull()
	})

	it("auto-detects a URL and renders it as a link", () => {
		render(<ComplianceComment comment="Visit https://example.com for details" />)
		const link = document.querySelector("a")
		expect(link).not.toBeNull()
		expect(link?.href).toBe("https://example.com/")
		expect(link?.target).toBe("_blank")
		expect(link?.rel).toBe("noopener noreferrer")
		expect(link?.textContent).toContain("https://example.com")
	})

	it("renders multiple URLs as separate links", () => {
		render(<ComplianceComment comment="See https://a.com and https://b.com for info" />)
		const links = document.querySelectorAll("a")
		expect(links.length).toBe(2)
		expect(links[0].textContent).toContain("https://a.com")
		expect(links[1].textContent).toContain("https://b.com")
	})

	it("renders surrounding text as spans, not links", () => {
		const { container } = render(<ComplianceComment comment="Before https://example.com after" />)
		const spans = container.querySelectorAll("span:not(.navds-sr-only)")
		const spanTexts = Array.from(spans).map((s) => s.textContent)
		expect(spanTexts).toContain("Before ")
		expect(spanTexts).toContain(" after")
	})

	it("handles http:// URLs as well", () => {
		render(<ComplianceComment comment="Link: http://insecure.com here" />)
		const link = document.querySelector("a")
		expect(link).not.toBeNull()
		expect(link?.textContent).toContain("http://insecure.com")
	})
})
