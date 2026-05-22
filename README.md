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
| `/admin/import` | Import av kontrollrammeverk fra Excel |
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

Starter PostgreSQL 18 i Docker og pusher schema.

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
   pnpm db:push
   # Valgfritt: pnpm db:seed for testdata
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
| `NAIS_API_URL` | `https://console.nav.cloud.nais.io/graphql` | Nais Console GraphQL API URL |
| `NAIS_API_TOKEN` | – | Bearer-token for Nais API (ikke nødvendig med lokal proxy) |
| `ENABLE_NAIS_SYNC` | `false` | Aktiver periodisk Nais-synkronisering (`true`/`false`) |
| `ENABLE_SYNC_JOB_RETENTION_CLEANUP` | `false` | Aktiver periodisk opprydding av gamle ferdige sync-jobber (`true`/`false`) |
| `SYNC_JOB_RETENTION_DAYS` | `90` | Antall dager ferdige sync-jobber beholdes før sletting |
| `SYNC_JOB_RETENTION_BATCH_SIZE` | `500` | Maks antall sync-jobber som slettes per cleanup-kjøring |

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
pnpm db:seed      # Seed testdata (kun manuelt)
pnpm dev:setup    # Docker Compose + push schema
pnpm dev:setup:postgresapp  # Postgres.app + push schema
```

### Nais API (lokal utvikling)

For å synkronisere team og applikasjoner fra Nais lokalt, bruk `nais alpha api proxy`:

```bash
nais alpha api proxy
```

Dette gjør Nais Console GraphQL API tilgjengelig på `http://localhost:4242` uten behov for token. `.env.example` er forhåndskonfigurert med denne URL-en.

Trykk **Synkroniser nå** på `/nais-overvaking` for å kjøre manuell synkronisering, eller sett `ENABLE_NAIS_SYNC=true` i `.env` for periodisk synkronisering hvert 5. minutt.

> **Produksjon:** Sett `NAIS_API_URL` til `https://console.nav.cloud.nais.io/graphql` og `NAIS_API_TOKEN` til et gyldig token.

### Database

Alle ruter henter data fra PostgreSQL via query-funksjoner i `app/db/queries/`. Kjør `pnpm db:seed` for å populere med testdata, eller bruk en tom database for å starte fra scratch.

## Datamodell

```
Organisasjon:  Seksjon → Klynge (valgfri) → Utviklingsteam → Applikasjon
Rammeverk:     Versjon → Domene → Risiko → Kontroll
Compliance:    Applikasjon × Kontroll → Vurdering (med historikk)
Rapporter:     Snapshot → Rapport (lagret i bucket)
```

## Overvåking – utgående HTTP-kall

Alle utgående HTTP-kall i applikasjonen logges strukturert via `loggedFetch()` i `app/lib/http-logger.server.ts`. Hvert kall produserer én loggmelding med faste felter som gjør det enkelt å filtrere og analysere i ELK og Loki.

### Feltstruktur

| Felt | Type | Eksempel | Beskrivelse |
|------|------|---------|-------------|
| `log_type` | string | `"outgoing_http"` | Fast diskriminator – brukes til å filtrere kun utgående kall |
| `area` | string | `"nais"` | Funksjonelt område som initierte kallet |
| `method` | string | `"POST"` | HTTP-metode |
| `host` | string | `"login.microsoftonline.com"` | Vertsnavn (uten path/query) |
| `path` | string | `"/oauth2/v2.0/token"` | Path-del av URL |
| `url` | string | `"https://login.microsoftonline.com/…?scope=read"` | Fullstendig URL (sensitive query-params redaktet) |
| `status` | number | `200` | HTTP-statuskode |
| `ok` | boolean | `true` | `true` om status er 200–299 |
| `durationMs` | number | `143` | Responstid i millisekunder |
| `error` | string | `"Connection refused"` | Settes kun ved nettverksfeil |
| `error_name` | string | `"TypeError"` | Feiltype ved nettverksfeil |
| `stack_trace` | string | `"TypeError: …\n  at …"` | Stack trace ved nettverksfeil |
| `cause` | string/array | `"ECONNREFUSED"` | Cause-kjede ved nettverksfeil |

Sensitive query-parametere (`token`, `secret`, `password`, `code`, `assertion` m.fl.) erstattes med `[REDACTED]` i `url`-feltet. Userinfo (brukernavn/passord i URL) fjernes alltid.

### Verdier for `area`

| `area` | System |
|--------|--------|
| `azure-ad` | Azure AD token-endepunkter (OBO + client credentials) |
| `nais` | Nais Console GraphQL API |
| `github` | GitHub Apps API |
| `microsoft-graph` | Microsoft Graph API |
| `deployment-audit` | Nav Deployment Audit API |
| `nda-audit` | NDA audit-rapporter |
| `oracle-revisjon` | Oracle revisjons-API |

### Analyse i ELK (Kibana)

**Filtrer alle utgående kall:**
```
log_type: "outgoing_http"
```

**Kall mot et bestemt system:**
```
log_type: "outgoing_http" AND area: "nais"
```

**Kun feilende kall (HTTP-feil):**
```
log_type: "outgoing_http" AND ok: false
```

**Kun nettverksfeil (ingen respons):**
```
log_type: "outgoing_http" AND error: *
```

**Trege kall (over 1 sekund):**
```
log_type: "outgoing_http" AND durationMs > 1000
```

**Kall mot en bestemt host:**
```
log_type: "outgoing_http" AND host: "login.microsoftonline.com"
```

Anbefalte kolonner i Kibana Discover: `@timestamp`, `area`, `method`, `host`, `path`, `status`, `durationMs`.

### Analyse i Loki (Grafana)

**Alle utgående kall (JSON-parsing):**
```logql
{app="kiss"} | json | log_type = "outgoing_http"
```

**Kall per område over tid:**
```logql
sum by (area) (
  rate({app="kiss"} | json | log_type = "outgoing_http" [5m])
)
```

**Gjennomsnittlig responstid per area:**
```logql
avg by (area) (
  avg_over_time(
    {app="kiss"} | json | log_type = "outgoing_http" | unwrap durationMs [5m]
  )
)
```

**Feilrate (non-2xx) per area:**
```logql
sum by (area) (
  rate({app="kiss"} | json | log_type = "outgoing_http" | ok = "false" [5m])
)
```

**Nettverksfeil:**
```logql
{app="kiss"} | json | log_type = "outgoing_http" | error != ""
```

## Integrasjoner

- **[Nav Deployment Audit](https://github.com/navikt/deployment-audit)**: Konsoliderte rapporter (planlagt)
- **Nais GraphQL API**: Automatisk oppdagelse av applikasjoner
- **Azure AD**: Autentisering og autorisasjon (OBO + Client Credentials)

## Lisens

Privat – Nav
