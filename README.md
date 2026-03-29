# KISS – Kontrollrammeverk for Integrert Sikker Systemutvikling

Internkontroll-applikasjon for å vise at Nav har kontroll på Software Development Life Cycle (SDLC).

## Hva gjør KISS?

- **Kontrollrammeverk**: Importerer og viser risikoer, kontroller og tiltak fra Navs kontrollrammeverk (Excel-import med staging)
- **Compliance-vurdering**: Lar ansvarlige per applikasjon svare ut om den er i overensstemmelse med retningslinjene
- **Nais-overvåking**: Automatisk oppdagelse av nye applikasjoner på Nais-plattformen
- **Rapporter**: Genererer compliance-rapporter per seksjon og på tvers av seksjoner
- **Dashboard**: Overordnet status for SDLC compliance med seksjon- og team-dashboards

## Brukergrupper

- **Utviklere / Techleads / Produktledere / Systemeiere**: Fyller ut compliance per applikasjon
- **Teknologileder**: Ser status og henter ut rapporter for sin seksjon
- **Revisorer / Internkontroll**: Ser status og henter ut rapporter for alle seksjoner

## Ruter

| Rute | Beskrivelse |
|------|-------------|
| `/` | Dashboard med overordnet SDLC compliance-status |
| `/kontrollrammeverk` | Oversikt over domener, risikoer og kontroller |
| `/kontrollrammeverk/:domene` | Detaljer for et domene |
| `/kontrollrammeverk/:domene/:kontrollId` | Detaljer for en kontroll |
| `/import` | Import av kontrollrammeverk fra Excel |
| `/applikasjoner` | Oversikt over overvåkede applikasjoner |
| `/applikasjoner/:appId/compliance` | Compliance-vurdering per applikasjon |
| `/seksjoner` | Seksjonsoversikt |
| `/seksjoner/:seksjon` | Seksjon-dashboard med team-status |
| `/seksjoner/:seksjon/team/:team` | Team-dashboard med app-status |
| `/rapporter` | Rapportoversikt |
| `/rapporter/generer` | Generer ny rapport |
| `/rapporter/:rapportId` | Rapport-detaljer |
| `/nais-overvaking` | Nais-teamovervåking og godkjenning |
| `/admin` | Administrasjon |

## Teknologistack

| Komponent | Valg |
|-----------|------|
| Runtime | Node.js 22 LTS |
| Framework | React Router 7 (Framework Mode, SSR) |
| UI | React 19, Aksel designsystem |
| Språk | TypeScript |
| ORM | Drizzle ORM |
| Database | PostgreSQL 18 (CloudSQL) |
| Objektlagring | GCS Buckets (prod) / Lokalt filsystem (dev) |
| Linting | Biome |
| Package manager | PNPM |
| Testing | Vitest, Testcontainers, Playwright, Storybook |
| Docker | Distroless |
| CI/CD | GitHub Actions |
| Autentisering | Wonderwall (JWT), Azure AD |
| Plattform | Nais |

## Utvikling

### Forutsetninger

- Node.js >= 22
- PNPM >= 10
- PostgreSQL 18 via **én** av:
  - [Docker](https://www.docker.com/) (Docker Compose)
  - [Postgres.app](https://postgresapp.com/) (macOS)

### Kom i gang

```bash
pnpm install
```

#### Alternativ A: Docker Compose (anbefalt)

```bash
pnpm dev:setup
pnpm dev
```

Starter PostgreSQL 18 i Docker, pusher schema og seeder testdata automatisk.

#### Alternativ B: Postgres.app

1. Installer og start [Postgres.app](https://postgresapp.com/) med PostgreSQL 18
2. Legg til Postgres.app sine CLI-verktøy i PATH (om du ikke allerede har gjort det):
   ```bash
   echo 'export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```
3. Opprett database og rolle:
   ```bash
   # Opprett kiss-rollen med passord (matcher Docker Compose-oppsettet)
   psql postgres -c "CREATE ROLE kiss WITH LOGIN PASSWORD 'kiss';"

   # Opprett databasen eid av kiss-rollen
   createdb --owner=kiss kiss

   # Verifiser at det fungerer
   psql -U kiss -d kiss -c "SELECT 1;"
   ```
4. Opprett `.env`:
   ```bash
   cp .env.example .env
   ```
   Endre `DATABASE_URL` i `.env`:
   ```
   DATABASE_URL=postgresql://kiss:kiss@localhost:5432/kiss
   ```
5. Kjør setup og start:
   ```bash
   pnpm db:push && pnpm db:seed
   pnpm dev
   ```

> **Tips:** Hvis du foretrekker å bruke din macOS-bruker uten passord, kan du i stedet sette `DATABASE_URL=postgresql://localhost:5432/kiss` og hoppe over steg 3.

Applikasjonen kjører på `http://localhost:3000`.

### Miljøvariabler

Kopier `.env.example` til `.env` for å tilpasse konfigurasjon:

| Variabel | Standard | Beskrivelse |
|----------|----------|-------------|
| `DATABASE_URL` | `postgresql://kiss:kiss@localhost:5432/kiss` | Postgres-tilkoblingsstreng |
| `STORAGE_PROVIDER` | `local` (dev) / `gcs` (prod) | `local` = filsystem, `gcs` = GCS bucket |
| `GCS_BUCKET_NAME` | – | Påkrevd når `STORAGE_PROVIDER=gcs` |

### Kommandoer

```bash
pnpm dev          # Utviklingsserver
pnpm build        # Bygg for produksjon
pnpm start        # Start produksjonsserver
pnpm test         # Kjør enhetstester
pnpm test:int     # Kjør integrasjonstester
pnpm lint         # Lint med Biome
pnpm format       # Formater med Biome
pnpm typecheck    # TypeScript typesjekking
pnpm check        # Lint + typecheck
pnpm knip         # Dead code-analyse
pnpm storybook    # Start Storybook
pnpm test:e2e     # Playwright e2e + UU-tester
pnpm db:push      # Push Drizzle-schema til lokal DB
pnpm db:migrate   # Kjør Drizzle-migrasjoner
pnpm db:generate  # Generer nye migrasjoner
pnpm db:studio    # Åpne Drizzle Studio (GUI)
pnpm db:seed      # Seed testdata
pnpm dev:setup    # Docker Compose + push + seed
pnpm dev:setup:postgresapp  # Postgres.app + push + seed
```

### Mock-data

All placeholder-data ligger i `app/lib/mock-data.server.ts`. Rutefiler importerer derfra – ingen inline mock-data i ruter. Se `AGENTS.md` for retningslinjer.

## Datamodell

```
Organisasjon:  Seksjon → Klynge (valgfri) → Utviklingsteam → Applikasjon
Rammeverk:     Versjon → Domene → Risiko → Kontroll
Compliance:    Applikasjon × Kontroll → Vurdering (med historikk)
Rapporter:     Snapshot → Rapport (lagret i bucket)
```

## Integrasjoner

- **[Nav Deployment Audit](https://github.com/navikt/deployment-audit)**: Konsoliderte rapporter (planlagt)
- **Nais GraphQL API**: Automatisk oppdagelse av applikasjoner
- **Azure AD**: Autentisering og autorisasjon (OBO + Client Credentials)

## Lisens

Privat – Nav
