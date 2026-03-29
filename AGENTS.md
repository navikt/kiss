# AGENTS.md – Retningslinjer for agentisk AI-utvikling

## Prosjektoversikt

KISS (Kontrollrammeverk for Integrert Sikker Systemutvikling) er Navs internkontroll-applikasjon for SDLC compliance. Den lar organisasjonen importere kontrollrammeverk, vurdere compliance per applikasjon, overvåke Nais-plattformen og generere rapporter.

## Teknologistack

- **React Router 7** i Framework Mode med Server Side Rendering
- **React 19** med **Aksel** designsystem (@navikt/ds-react, @navikt/ds-css)
- **TypeScript** (strict mode)
- **Drizzle ORM** med PostgreSQL 17
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
│   └── migrations/       # SQL-migrasjoner
├── hooks/                # Custom React hooks
├── lib/                  # Forretningslogikk og utilities
│   ├── auth.server.ts    # JWT-validering og autorisasjon
│   ├── azure.server.ts   # Azure AD token-håndtering
│   ├── nais.server.ts    # Nais GraphQL-integrasjon
│   ├── mock-data.server.ts # All mock/testdata (se nedenfor)
│   └── ...
├── routes/               # React Router ruter (hver i egen mappe)
├── styles/               # CSS
├── entry.server.tsx      # SSR entry point
├── root.tsx              # Root layout
└── routes.ts             # Rutedefinisjon
```

## Utvikling

### Mock-data og testdata
All mock-data som brukes som placeholder før databaseintegrasjon skal ligge i `app/lib/mock-data.server.ts` – **aldri inline i rutefiler**. Dette gir:
- Én fil å oppdatere når mock-data skal endres
- Tydelig oversikt over hva som er mock vs. produksjonskode
- Enkel overgang til database-queries (bytt import til `db/queries/`)

Rutefiler importerer mock-data slik:
```ts
import { mockApps, compliancePercent } from "~/lib/mock-data.server"
```

Når database-integrasjon er klar, erstattes importen med:
```ts
import { getApps } from "~/db/queries/apps.server"
```

Enhetstester (`app/**/__tests__/`) kan importere mock-data direkte. Integrasjonstester skal bruke Testcontainers med egen testdata.

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
3. **Tabeller** – Wrap alle `<Table>` i `<section className="table-scroll" aria-label="...">` for horisontal scroll på mobil
4. **Aldri hardkodede bredder** – Bruk `width: 100%; max-width: 80rem; margin: 0 auto;`
5. **Test på 3 breakpoints** – 375px (mobil), 768px (nettbrett), 1280px (desktop)
6. **Aksel VStack** – Bruk for alle vertikale layouts (automatisk responsiv)

### Testing
```bash
pnpm test:e2e              # Kjør Playwright responsive tester
pnpm test:e2e:ui           # Playwright med UI
pnpm storybook             # Storybook med viewport-presets
```

## Nais-plattform

Applikasjonen kjører på Nais med:
- CloudSQL PostgreSQL 17 (point-in-time recovery, audit logging)
- GCS Buckets (11 års retention, ingen sletting)
- Wonderwall for autentisering (Azure AD)
- Automatisk deploy via GitHub Actions
