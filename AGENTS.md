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
│   └── ...
├── routes/               # React Router ruter (hver i egen mappe)
├── styles/               # CSS
├── entry.server.tsx      # SSR entry point
├── root.tsx              # Root layout
└── routes.ts             # Rutedefinisjon
```

## Utvikling

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

## Nais-plattform

Applikasjonen kjører på Nais med:
- CloudSQL PostgreSQL 17 (point-in-time recovery, audit logging)
- GCS Buckets (11 års retention, ingen sletting)
- Wonderwall for autentisering (Azure AD)
- Automatisk deploy via GitHub Actions
