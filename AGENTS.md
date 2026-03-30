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

## Filstruktur

### Ruter
Hver rute har sin egen mappe. Rutefilen heter `index.tsx`:
```
app/routes/
├── _index/index.tsx
├── kontrollrammeverk/index.tsx
├── kontrollrammeverk.$domene/index.tsx
└── ...
```

### Server-only filer
Filer som ender på `.server.ts` eller `.server.tsx` kjører kun på serveren. Database-tilgang, autentisering og eksterne API-kall skal alltid være i `.server.ts`-filer.

### Mappestruktur
```
app/
├── components/           # Gjenbrukbare React-komponenter
├── db/                   # Database (Drizzle schema, queries, migrasjoner)
│   ├── schema/           # Drizzle tabelldefinisjoner
│   ├── queries/          # Database-spørringer (.server.ts)
│   ├── migrations/       # SQL-migrasjoner
│   └── seed.ts           # Testdata-seeding (pnpm db:seed)
├── hooks/                # Custom React hooks
├── lib/                  # Forretningslogikk og utilities
│   ├── auth.server.ts    # JWT-validering og autorisasjon
│   ├── azure.server.ts   # Azure AD token-håndtering
│   ├── nais.server.ts    # Nais GraphQL-integrasjon
│   ├── utils.ts          # Delte utility-funksjoner (client-safe)
│   └── storage/          # Lagringsabstraksjon
│       ├── types.ts      # StorageProvider-interface
│       ├── local.server.ts  # Lokalt filsystem (.local-storage/)
│       ├── gcs.server.ts    # Google Cloud Storage
│       └── index.server.ts  # Factory (velger provider)
├── routes/               # React Router ruter (hver i egen mappe)
├── styles/               # CSS
├── entry.server.tsx      # SSR entry point
├── root.tsx              # Root layout
└── routes.ts             # Rutedefinisjon
```

## Utvikling

### Database-queries
Alle ruter henter data fra PostgreSQL via query-funksjoner i `app/db/queries/`:

```ts
import { getDomainSummaries } from "~/db/queries/framework.server"
import { getApplications } from "~/db/queries/applications.server"
import { getSectionDetail } from "~/db/queries/sections.server"
```

Query-filer:
- `framework.server.ts` – Domener, risikoer, kontroller
- `applications.server.ts` – Applikasjoner, compliance-vurderinger
- `nais.server.ts` – Nais-team
- `sections.server.ts` – Seksjoner, team-statistikk
- `reports.server.ts` – Rapporter

Testdata seedes med `pnpm db:seed` (se `app/db/seed.ts`). Uten seed vil applikasjonen vise tomme tilstander.

### Lagringsabstraksjon (StorageProvider)
Fillagring bruker `StorageProvider`-interfacet i `app/lib/storage/`:

```ts
import { getStorageProvider } from "~/lib/storage/index.server"

const storage = getStorageProvider()
await storage.upload("reports/rapport-1.pdf", pdfBuffer, { contentType: "application/pdf" })
const data = await storage.download("reports/rapport-1.pdf")
```

- **Lokal utvikling**: Filer lagres i `.local-storage/` (gitignorert)
- **Produksjon**: Filer lagres i GCS bucket (satt via `GCS_BUCKET_NAME`)
- Provider velges automatisk basert på `STORAGE_PROVIDER` env var (`local`/`gcs`)
- **Aldri** bruk `@google-cloud/storage` direkte – bruk alltid `getStorageProvider()`

### Lokal utviklingsoppsett
```bash
pnpm install          # Installer avhengigheter
pnpm dev:setup        # Start Postgres, push schema
pnpm dev              # Start utviklingsserver
```

Docker Compose kjører PostgreSQL 18 lokalt. Drizzle bruker `db:push` for rask iterasjon og `db:migrate` for produksjonsmigrasjoner.

### Server-only imports i rutefiler
React Router 7 fjerner `.server`-imports kun fra `loader`/`action`/`middleware`/`headers`. Funksjoner som brukes i JSX-komponenter **kan ikke** importeres fra `.server.ts`-filer. Bruk `app/lib/utils.ts` for delte utility-funksjoner som trengs på klienten.

### Testdrevet utvikling
- **Tester skrives FØRST** – alltid før implementasjon
- Integrasjonstester mot database bruker Testcontainers
- Frontend-tester bruker Storybook og Playwright
- UU-tester med axe-core

### Branch-strategi
- All utvikling skjer i feature branches
- Alle endringer skal sjekkes med AI-agenter (Opus, Sonnet, Codex)

### Viktige regler
1. **Ikke modifiser** genererte filer i `build/`, `dist/`, `.react-router/`
2. **Kjør alltid** `pnpm check` før commit
3. **Server-only kode** skal alltid ha `.server.ts`-suffiks
4. **Alle tabeller** skal ha audit-kolonner (created_at, created_by, updated_at, updated_by)
5. **Historikk** skal bevares – data slettes aldri, bare arkiveres
6. **Audit-logging er PÅKREVD** for alle CRUD-operasjoner:
   - Alle opprettelser, endringer og slettinger skal logges til `audit_log`-tabellen via `writeAuditLog()` i `app/db/queries/audit.server.ts`
   - Loggoppføringer skal inkludere: `action`, `entityType`, `entityId`, `previousValue` (ved endring/sletting), `newValue` (ved opprettelse/endring), `metadata` (kontekst), og `performedBy`
   - Nye action-typer skal legges til i `auditLogActionEnum` i `app/db/schema/audit.ts`
   - **Endringsloggen skal alltid vises i brukergrensesnittet** på den relevante admin-/oversiktssiden, slik at brukerne kan se hva som er endret, av hvem og når
   - Bruk `<Table>` med kolonner: Tidspunkt, Handling, Detaljer, Utført av
7. **Database-seeding (`pnpm db:seed`) skal ALDRI kjøres automatisk** – verken i `dev:setup`, CI/CD, eller av AI-agenter i autopilot-modus. Seeding skal kun utføres når brukeren eksplisitt ber om det.
8. **E2e-tester som oppretter data i databasen SKAL alltid rydde opp etter seg.** Tester som oppretter seksjoner, team, applikasjoner osv. via UI skal slette dem igjen i samme test. Testdata som ligger igjen forurenser utviklingsdatabasen.

### Kontroll-ID-formater
- Nav MKR: `K-XX.NN` (f.eks. `K-ST.01`, `K-TS.03`)
- Risiko: `R-XX.NN` (f.eks. `R-ST.01`, `R-TS.01`)

### Compliance-statuser
- `not_relevant` – Ikke relevant
- `not_implemented` – Ikke implementert
- `partially_implemented` – Delvis implementert
- `implemented` – Implementert

## Responsivt design

### Breakpoints
- **xs:** 0px (mobil, default)
- **sm:** 640px (stor mobil)
- **md:** 768px (nettbrett)
- **lg:** 1024px (desktop)
- **xl:** 1280px (bred skjerm)

### CSS-tokens (Aksel v8)
Aksel v8 bruker `--ax-*` tokens (IKKE `--a-*`):
- Spacing: `--ax-space-4`, `--ax-space-8`, `--ax-space-12`, `--ax-space-16`, `--ax-space-24`
- Farger: `--ax-bg-brand-blue-strong`, `--ax-text-default`, `--ax-border-subtle`
- Radius: `--ax-radius-4`, `--ax-radius-8`
- Font: `--ax-font-size-small`, `--ax-font-size-medium`, `--ax-font-size-heading-xlarge`

### Retningslinjer
1. **Mobile-first** – Design for mobil først, utvid for større skjermer
2. **Aksel HGrid for grid** – Bruk `columns={{ xs: 1, sm: 2, md: 4 }}` for responsive grids
3. **Tabeller** – Wrap alle `<Table>` i `<section className="table-scroll" tabIndex={0} aria-label="...">` for horisontal scroll på mobil. Bruk `tabIndex={0}` (ikke `-1`) slik at tastaturbrukere kan navigere scrollbart innhold.
4. **Aldri hardkodede bredder** – Bruk `width: 100%; max-width: 80rem; margin: 0 auto;`
5. **Test på 3 breakpoints** – 375px (mobil), 768px (nettbrett), 1280px (desktop)
6. **Aksel VStack** – Bruk for alle vertikale layouts (automatisk responsiv)

### Testing
```bash
pnpm test:e2e              # Kjør Playwright responsive tester + UU
pnpm test:e2e:ui           # Playwright med UI
pnpm storybook             # Storybook med viewport-presets
```

## Universell utforming (UU / WCAG)

### Automatisert testing med axe-core
Playwright-tester i `e2e/accessibility.spec.ts` kjører axe-core mot alle sider og sjekker WCAG 2.1 AA:
- Fargekontrast (minimum 4.5:1 for normal tekst, 3:1 for stor tekst)
- Formularelementer med labels
- ARIA-attributter
- Tastaturnavigasjon
- Bildetekster

### Kontrastregler
- **Aldri** bruk `--ax-text-brand-blue-contrast` (hvit) på lyse bakgrunner som `--ax-bg-brand-blue-moderate`
- Hvit tekst krever mørk bakgrunn: bruk `--ax-bg-brand-blue-strong` eller mørkere
- Beregn alltid kontrastforhold ved nye fargekombinasjoner (verktøy: WebAIM Contrast Checker)
- Nav-baren bruker `--ax-bg-brand-blue-strong` (#457c9d) med hvit tekst = 4.54:1 ✓

### WCAG 2.1 AA sjekkliste for nye komponenter
1. Fargekontrast ≥ 4.5:1 (normal tekst) / ≥ 3:1 (stor tekst / UI-elementer)
2. Interaktive elementer nåbare via tastatur
3. Meningsfulle `aria-label` på navigasjon, regioner og skjemaer
4. Skip-link til hovedinnhold (allerede i root.tsx)

## Nais-plattform

Applikasjonen kjører på Nais med:
- CloudSQL PostgreSQL 18 (point-in-time recovery, audit logging)
- GCS Buckets (11 års retention, ingen sletting)
- Wonderwall for autentisering (Azure AD)
- Automatisk deploy via GitHub Actions

### Multi-pod og distribuert kjøring

KISS kjører med **flere podder i parallell** på Nais. Dette betyr at:

1. **Bakgrunnsjobber** (f.eks. Nais-synkronisering) må bruke **PostgreSQL advisory locks** for å unngå duplikat kjøring.
2. **Aldri anta single-instance** – all kode som kjører periodisk eller i bakgrunnen MÅ bruke låsemekanismen.
3. Bruk `withAdvisoryLock()` fra `app/lib/lock.server.ts` for alle bakgrunnsjobber:

```ts
import { withAdvisoryLock } from "~/lib/lock.server"

const result = await withAdvisoryLock("my-job-name", async () => {
  // Kun én pod kjører dette om gangen
  return await doExpensiveWork()
})

if (result === null) {
  // En annen pod holder allerede låsen – hopp over
}
```

4. Låser bruker `pg_try_advisory_lock` (ikke-blokkerende) og frigjøres med `pg_advisory_unlock` i en `finally`-blokk.
5. Ulike jobber skal bruke ulike låsnavn for uavhengig parallelitet.

### Nais-synkronisering

KISS scanner Nais-plattformen for å oppdage team og applikasjoner:

- **Scheduler**: Periodi sk synkronisering hvert 5. minutt (konfigurerbart via `ENABLE_NAIS_SYNC`)
- **Manuell trigger**: `POST /api/nais-sync` (krever autentisering)
- **GraphQL API**: Bruker Nais Console API (`NAIS_API_TOKEN`)
- **Låsemekanisme**: `nais-full-sync`, `nais-sync-teams`, `nais-sync-apps-{teamSlug}` advisory locks
- **Persistering**: Oppdagede team og apper upsert-es til databasen med audit-logging
