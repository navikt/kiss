# AGENTS.md – Retningslinjer for agentisk AI-utvikling

## Prosjektoversikt

KISS (Kontrollrammeverk for Integrert Sikker Systemutvikling) er Navs internkontroll-applikasjon for SDLC compliance. Den lar organisasjonen importere kontrollrammeverk, vurdere compliance per applikasjon, overvåke Nais-plattformen og generere rapporter.

## Teknologistack

- **React Router 7** i Framework Mode med Server Side Rendering
- **React 19** med **Aksel** designsystem (@navikt/ds-react, @navikt/ds-css)
- **TypeScript** (strict mode)
- **Drizzle ORM** med PostgreSQL 18
- **Biome** for linting og formattering
- **PNPM** som package manager
- **Vitest** + **Testcontainers** for testing
- **Storybook** + **Playwright** for frontend-testing

## Kodestil

- **Biome** håndterer all linting og formattering
- **Tabber** for indentasjon
- **Ingen semikolon** med mindre det er syntaktisk nødvendig
- **Trailing commas** skal brukes
- Kommentarer kun når koden trenger klargjøring
- Linjbredde: 120 tegn
- **TypeScript null-filtrering**: `.filter(x => x !== null)` narrower IKKE typen i strict mode. Bruk alltid type guard:
  ```ts
  .filter((x): x is NonNullable<typeof x> => x !== null)
  ```

## Terminologi

- Bruk **applikasjoner** (ikke «apper» eller «apps») i alle brukervendte tekster, labels, tab-titler og dokumentasjon
- I kode (variabelnavn, funksjoner, database-kolonner) er `apps`/`app` OK for korthet

## Filstruktur

### Server-only filer
Filer som ender på `.server.ts` eller `.server.tsx` kjører kun på serveren. Database-tilgang, autentisering og eksterne API-kall skal alltid være i `.server.ts`-filer.

### Mappestruktur
```
app/
├── components/           # Gjenbrukbare React-komponenter
├── db/
│   ├── schema/           # Drizzle tabelldefinisjoner
│   ├── queries/          # Database-spørringer (.server.ts)
│   └── migrations/       # SQL-migrasjoner
├── lib/
│   ├── auth.server.ts    # JWT-validering og autorisasjon
│   ├── utils.ts          # Delte utility-funksjoner (client-safe)
│   ├── activity-types.ts # Aktivitetstyper, provider-mappinger, type guards
│   ├── evidence-providers/  # Bevisinnhenting (se docs/architecture.md)
│   └── storage/          # Lagringsabstraksjon (se docs/architecture.md)
├── routes/               # React Router ruter (hver i egen mappe med index.tsx)
└── routes.ts             # Rutedefinisjon
```

## Lokal utviklingsoppsett

```bash
pnpm install          # Installer avhengigheter
pnpm dev:setup        # Start Postgres, push schema
pnpm dev              # Start utviklingsserver
pnpm check            # Biome + React Router typegen + tsc (kjør før commit)
```

## Testdrevet utvikling

- **Tester skrives FØRST** – alltid før implementasjon
- Integrasjonstester mot database bruker Testcontainers
- Frontend-tester bruker Storybook og Playwright
- UU-tester med axe-core

### Test-datanavn

- Fiktive personnavn: `"Adjektiv Substantiv"` (norsk) — f.eks. `"Glad Fjord"`, `"Rask Elv"`. Ikke «Ola Nordmann».
- Fiktive NAV-identer: `Z99xxxx` — f.eks. `"Z990001"`, `"Z990042"`. Ikke `A123456`.

## Branch-strategi

- All utvikling skjer i feature branches
- Alle endringer skal sjekkes med AI-agenter (Opus, Sonnet, Codex)

## Kontroll-ID-formater og compliance-statuser

- Nav MKR: `K-XX.NN` (f.eks. `K-ST.01`) / Risiko: `R-XX.NN`
- Statuser: `not_relevant`, `not_implemented`, `partially_implemented`, `implemented`

---

## Når du må lese docs-filer

| Oppgave | Les |
|---|---|
| Legge til ny rute | [`docs/routing.md`](docs/routing.md) |
| Ny vedlikeholdsaktivitetstype | [`docs/activity-types.md`](docs/activity-types.md) og [`docs/staged-data-pattern.md`](docs/staged-data-pattern.md) |
| Ny bevisaktivitetstype | [`docs/activity-types.md`](docs/activity-types.md) |
| Seksjon-app-tilhørighet, StorageProvider, Evidence Providers, Nais | [`docs/architecture.md`](docs/architecture.md) |
| Responsivt design, UU/WCAG | [`docs/ui-conventions.md`](docs/ui-conventions.md) |

---

## Viktige regler

1. **Ikke modifiser** genererte filer i `build/`, `dist/`, `.react-router/`
2. **Kjør alltid** `pnpm check` før commit
3. **Server-only kode** skal alltid ha `.server.ts`-suffiks
4. **Alle tabeller** skal ha audit-kolonner (created_at, created_by, updated_at, updated_by)
5. **Historikk** skal bevares – data slettes aldri, bare arkiveres
6. **Audit-logging er PÅKREVD** for alle CRUD-operasjoner via `writeAuditLog()` i `app/db/queries/audit.server.ts`. Nye action-typer legges til i `auditLogActionEnum` i `app/db/schema/audit.ts`. Endringsloggen skal alltid vises i brukergrensesnittet med kolonner: Tidspunkt, Handling, Detaljer, Utført av.
7. **`pnpm db:seed` skal ALDRI kjøres automatisk** – verken i `dev:setup`, CI/CD, eller av AI-agenter i autopilot-modus. Kun når brukeren eksplisitt ber om det.
8. **E2e-tester som oppretter data SKAL alltid rydde opp etter seg** – testdata som ligger igjen forurenser utviklingsdatabasen.
9. **`db:push` og `drizzle-kit push` skal ALDRI kjøres av AI-agenter mot utviklingsdatabasen.** `--force`-flagget er STRENGT FORBUDT. Integrasjonstester med Testcontainers er unntatt.
10. **AI-agenter skal ALDRI kjøre e2e-tester mot utviklingsdatabasen uten eksplisitt godkjenning.**
11. **AI-agenter skal ALDRI utføre destruktive databaseoperasjoner uten å spørre brukeren først.** Dette inkluderer DROP TABLE, DELETE uten WHERE, TRUNCATE, og migreringsverktøy som kan endre eller fjerne tabeller.
12. **`complianceAssessments` og `complianceAssessmentHistory` er DEPRECATED.** Bruk ikke i nye funksjoner. Compliance-status utledes fra `screeningAnswers`, `rulesetControls` og `routineControls`.
13. **Statiske imports i `.server.ts`-filer.** Dynamiske imports (`await import(...)`) kun for å bryte sirkulære avhengigheter.
14. **Forretningsinvarianter skal håndheves i query-laget** – `createX`/`updateX`-funksjoner i `app/db/queries/` skal validere domene-invarianter, ikke bare stole på UI-validering.
15. **Valgfrie params i update-funksjoner skal ikke resette verdier.** Inkluder kun feltet i SQL SET-klausulen når det er eksplisitt oppgitt (`params.x !== undefined`).
16. **Migrasjoner skal være idempotente.** Bruk `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `DROP COLUMN IF EXISTS` osv.
17. **Arkiverte apper skal filtreres fra app-lister** (`archivedAt IS NOT NULL`) med mindre arkiverte apper eksplisitt er ønsket.
18. **Bruk `loggedFetch()` fra `app/lib/http-logger.server.ts`** for alle utgående HTTP-kall. Aldri `fetch()` direkte i `.server.ts`-filer.
