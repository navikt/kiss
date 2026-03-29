/** Calculate compliance percentage from implementation counts. */
export function compliancePercent(implemented: number, partial: number, total: number): number {
	return total > 0 ? Math.round(((implemented + partial * 0.5) / total) * 100) : 0
}
