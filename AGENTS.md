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
│   ├── activity-types.ts # Aktivitetstyper, provider-mappinger, type guards
│   ├── evidence-providers/  # Bevisinnhenting fra eksterne systemer
│   │   ├── types.ts         # EvidenceProvider-interface, provider-typer
│   │   ├── index.server.ts  # Factory: getEvidenceProvider(type)
│   │   ├── oracle.server.ts # Oracle-provider (wrapper rundt oracle-revisjon.server.ts)
│   │   ├── nda.server.ts    # NDA-provider (stub, implementeres senere)
│   │   ├── ui-config.ts     # Provider-spesifikke UI-labels og formattering
│   │   └── validation.server.ts # Tilgangs- og bevistype-validering
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

### Seksjon-app-tilhørighet

Applikasjoner er **IKKE** direkte knyttet til seksjoner via en `section_id`-kolonne på `monitored_applications`. Tilhørighet resolves indirekte via tre stier:

1. **Dev teams**: `application_team_mappings` → `dev_teams.section_id`
2. **NAIS teams**: `application_environments` → `nais_teams.section_id`
3. **Dev-NAIS mappinger**: `application_environments` → `dev_team_nais_team_mappings` → `dev_teams.section_id`

Canonical funksjoner i `app/db/queries/sections.server.ts`:
- `getEffectiveAppIdsInSection(sectionId)` — Returnerer alle effektive app-IDer med filtrering (barn-apper, ignorerte, ekskluderte miljøer, arkiverte)
- `isAppEffectiveInSection(appId, sectionId)` — Målrettet membership-sjekk for én app (mer effektiv enn å laste hele listen)

**Viktig:** Opprett aldri en `section_id`-kolonne på `monitored_applications`. Bruk alltid de canonical funksjonene over. I integrasjonstester, koble apper til seksjoner via `dev_teams` + `application_team_mappings`.

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

### Bevisinnhenting (Evidence Providers)
Revisjonsbevis hentes fra eksterne systemer via provider-abstraksjon i `app/lib/evidence-providers/`:

```ts
import { getEvidenceProvider } from "~/lib/evidence-providers/index.server"

const provider = await getEvidenceProvider("oracle")
const status = await provider.getStatus({ instanceId: "PENSJON_PROD" })
const file = await provider.downloadFile({ instanceId: "PENSJON_PROD" }, "audit", "excel")
```

- **Registrerte providere**: `oracle` (pensjon-oracle-revisjon), `deployments` (NDA – stub)
- **Aktivitetstype → provider**: `getProviderTypeForActivity()` i `activity-types.ts`
- **UI-config**: `getProviderUiConfig()` i `ui-config.ts` gir provider-spesifikke labels
- **API-ruter**: `/api/evidence-status`, `/api/evidence-download`, `/api/evidence-file/:downloadId`
- **Aldri** legg til Oracle-spesifikk logikk i generiske ruter eller komponenter – bruk provider-interfacet
- **Nye providere** implementeres som en klasse som implementerer `EvidenceProvider`-interfacet

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

### Nye ruter
Når nye ruter introduseres:
1. **Legg til ruten i `app/routes.ts` FØRST** – uten ruteregistrering vil URLen gi 404
2. **Verifiser at alle lenker peker til registrerte ruter** – sjekk at `to`-proppen i `<Link>` og `<Button as={Link}>` matcher et mønster i `routes.ts`
3. **Test at ruten svarer med HTTP 200** før commit – bruk `curl -s -o /dev/null -w '%{http_code}' <url>`
4. **Sjekk at lenker fra eksisterende sider fungerer** – navigasjonsflyt skal testes ende-til-ende
5. **Alle `redirect()`-kall skal bruke absolutte stier** – relative stier som `../rutiner/` kan resolveres feil avhengig av kontekst. Bruk alltid absolutte stier som `/seksjoner/${seksjon}/rutiner/${id}`.
6. **Relative lenker (`to="./..."` og `to="../..."`) skal resolves mot rutens eget mønster og valideres** – en relativ lenke som `./ny-gjennomgang` fra ruten `seksjoner/:seksjon/rutiner/:rutineId` resolves til `/seksjoner/:seksjon/rutiner/:rutineId/ny-gjennomgang`, som må matche en registrert rute.
7. **`href`-attributter som peker til interne API-ruter** (f.eks. `href="/api/rutine-vedlegg/${id}"`) skal også valideres mot registrerte ruter.
8. **Automatiserte tester SKAL opprettes** for å verifisere:
   - At alle ruter definert i `routes.ts` har en tilhørende rutefil
   - At alle `redirect()`-kall i action-funksjoner peker til ruter som finnes i `routes.ts`
   - At alle `<Link to="...">` og `<Button as={Link} to="...">` i rutekomponenter peker til gyldige ruter
   - At alle relative lenker (`./`, `../`) resolves korrekt mot rutens mønster og matcher en registrert rute
   - At alle `href="..."`-attributter som peker til interne stier matcher registrerte ruter

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
9. **`db:push` og `drizzle-kit push` skal ALDRI kjøres av AI-agenter mot utviklingsdatabasen.** Schema-endringer mot lokal database krever eksplisitt godkjenning fra brukeren. `--force`-flagget er STRENGT FORBUDT da det hopper over bekreftelsesdialoger og kan slette tabeller med data. Integrasjonstester med Testcontainers bruker sin egen database og er unntatt fra denne regelen.
10. **AI-agenter skal ALDRI kjøre e2e-tester mot utviklingsdatabasen uten eksplisitt godkjenning.** E2e-tester kjører mot den lokale databasen og kan forurense den med testdata. Bruk unit-tester og integrasjonstester (Testcontainers) for validering.
11. **AI-agenter skal ALDRI utføre destruktive databaseoperasjoner uten å spørre brukeren først.** Dette inkluderer DROP TABLE, DELETE uten WHERE, TRUNCATE, og alle migreringsverktøy som kan endre eller fjerne tabeller. Selv i autopilot-modus skal agenten stoppe og spørre.
12. **`complianceAssessments` og `complianceAssessmentHistory` er DEPRECATED.** Disse tabellene og tilhørende funksjoner (`saveAssessment`, `saveAssessmentComment`, ruten `compliance-krav`) er legacy. Compliance-status skal utledes fra screening-spørsmål (`screeningQuestions`/`screeningAnswers`), regelsett (`rulesets`/`rulesetControls`) og rutiner (`routines`/`routineControls`). **Ikke bruk `complianceAssessments` i nye funksjoner.** Eksisterende bruk skal fases ut over tid.
13. **Statiske imports i `.server.ts`-filer.** Bruk alltid statiske imports for moduler som allerede er hard dependencies (f.eks. `drizzle-orm`, schema-filer). Dynamiske imports (`await import(...)`) skal kun brukes for å bryte sirkulære avhengigheter mellom query-filer (f.eks. `routines.server.ts` ↔ `sections.server.ts`).
14. **Forretningsinvarianter skal håndheves i query-laget.** `createX`/`updateX`-funksjoner i `app/db/queries/` skal validere og normalisere domene-invarianter, ikke bare stole på UI/action-validering. Eksempel: seksjonsrutiner tvinger `appliesToAllInSection=1` og `activityType=null` direkte i `createRoutine`/`updateRoutine`.
15. **Valgfrie params i update-funksjoner skal ikke resette verdier.** Når en `updateX`-funksjon har valgfrie parametere (f.eks. `isSectionRoutine?: boolean`), skal de kun inkluderes i SQL SET-klausulen når de er eksplisitt oppgitt (`params.x !== undefined`). `params.x ? 1 : 0` evaluerer til `0` når `x` er `undefined`, som silently resetter verdien.
16. **Migrasjoner skal være idempotente.** Bruk `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `DROP COLUMN IF EXISTS` osv. Dette er nødvendig fordi `migrations.integration.test.ts` simulerer en `db:push` → `db:migrate`-overgang der kolonner kan eksistere allerede.
17. **Arkiverte apper skal filtreres fra app-lister.** Funksjoner som returnerer lister over applikasjoner (f.eks. `getEffectiveAppIdsInSection`, team-app-resolver) skal filtrere bort arkiverte apper (`archivedAt IS NOT NULL`) med mindre arkiverte apper eksplisitt er ønsket.

### Rutinegjennomganger, vedlikeholdsaktiviteter og rapporter

#### Oversikt over aktivitetstyper

Det finnes to arkitektonisk ulike kategorier aktivitetstyper. Tabellen under er den autoritative listen over eksisterende og planlagte aktivitetstyper.

| Aktivitetstype | Kategori | Per-gjennomgang-tabell (seed/vurdering) | Commit til primærlagring | Status |
|---|---|---|---|---|
| `oracle_role_criticality` | Vedlikehold | `routine_oracle_role_criticality_assessments` *(planlagt)* | Ja *(planlagt)* | 🔲 Planlagt |
| `rpa_user_maintenance` | Vedlikehold | `routine_rpa_user_assessments` | ⚠️ Mangler (tech debt) | ✅ Implementert |
| `entra_id_group_maintenance` | Vedlikehold | Ingen ekte seed-tabell *(avvik)*. `routine_review_activity_entra_changes` logger endringer | ⚠️ Avvik (tech debt) | ✅ Implementert |
| `oracle_evidence_audit` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_profiles` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_roles` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_users` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_period` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_all` | Bevis | Ingen | Nei | ✅ Implementert |
| `deployment_evidence_report` | Bevis | Ingen | Nei | ✅ Implementert |

#### Prinsipper for vedlikeholdsaktiviteter

Disse prinsippene er **bindende krav for alle nye vedlikeholdsaktivitetstyper**. Eksisterende typer kan ha kjente avvik — se avvikstabellen. Bevisaktiviteter er arkitektonisk ulike og følger ikke disse prinsippene.

##### Begrepsdefinisjoner

- **`is_gone = true`**: Verdien ble ikke returnert av M2M-API ved aktivitetsstart i denne gjennomgangen. Er gjennomgangs-spesifikk og lagres kun i per-gjennomgang-tabellen.
- **`archivedAt IS NOT NULL`**: Verdien er soft-deleted i KISS primærlagring — typisk satt av en tidligere gjennomgang ved commit. Er permanent og lagret i applikasjonens primærlagring.
- **Aktiv vurdering i KISS**: En rad i primærlagringen med `archivedAt IS NULL` og obligatoriske vurderingsfelt satt (f.eks. `criticality IS NOT NULL`).
- **Matching-nøkkel**: Nøkkelen som avgjør at én verdi i KISS og én verdi fra M2M-API er «samme verdi». **Defineres eksplisitt per aktivitetstype i implementasjonen** (f.eks. Oracle: `instance_id + role_name`, Entra: `groupId`). Dokumenteres med navngitt konstant i seed-funksjonen. Seed-funksjonen **skal normalisere matching-nøkkel** (trim whitespace, konsistent casing) og **deduplisere API-input** før insert — duplikater fra API skal avvises eksplisitt.

##### 1. Snapshot-prinsipp (rapport-integritet)

Resultater av en gjennomgang lagres som uforanderlige snapshots (`snapshotBefore`/`snapshotAfter`) på `routine_review_activities`. Rapporten skal alltid reflektere tilstanden **nøyaktig slik den var da gjennomgangen ble gjennomført** — uavhengig av hva som skjer med applikasjonens primærlagring etterpå.
- `snapshotBefore` tas ved oppstart av aktiviteten — **KISS-tilstand *før* API-fletting** (aktive verdier fra primærlagring, uten fletteendringer). Snapshottet KAN anrikes med presentasjonsdata fra M2M-API (f.eks. gruppenavn fra Microsoft Graph), men tilstandsfelter (`is_new`/`is_gone`) reflekterer KISS-tilstand FØR fletting. Hvis API er utilgjengelig, inkluderes `apiUnavailable: true` *(målarkitektur — ikke implementert i eksisterende typer)*.
- `snapshotAfter` tas ved fullføring av aktiviteten (endelig tilstand etter commit), **i samme transaksjon** som commit til primærlagring.
- Begge snapshots lagres som JSONB på aktiviteten og inngår i rapporten — aldri live data.

**Snapshot-format — målarkitektur for nye aktivitetstyper:**

*(Eksisterende Entra-snapshots er lagret uten `type`/`schemaVersion` — legacy-format, se under.)*

Alle nye snapshots lagres med `type`- og `schemaVersion`-felt for sikker tolkning og fremtidig migrering:

```typescript
// Målarkitektur — nye aktivitetstyper skal bruke dette formatet
// type-feltet = aktivitetstypen (f.eks. "oracle_role_criticality"), ikke et separat snapshot-navn
type ReviewSnapshot =
	| { type: "oracle_role_criticality"; schemaVersion: 1; apiUnavailable?: true; roles: OracleRoleEntry[] }
	| { type: "oracle_evidence_audit"; schemaVersion: 1; evidenceType: string; collectedAt: string; bucketPath: string }
	// Alle evidence-typer bruker samme feltstruktur, men type-diskriminanten = aktivitetstypen (f.eks. "oracle_evidence_roles")
	// Legacy (Entra): { groups: EntraGroupEntry[] }  — mangler type og schemaVersion
```

- **Nye aktivitetstyper** skal alltid bruke diskriminert union med `type` og `schemaVersion`.
- **Eksisterende Entra-snapshots** i DB mangler `type`-felt (lagret som rå `{ groups: [...] }`). Parser skal falle tilbake til `activity.type` for å avgjøre parsing — for legacy Entra er dette `"entra_id_group_maintenance"`.
- Rapportgeneratoren **skal sjekke `snapshot.type`** — og falle tilbake til `activity.type` kun for legacy Entra-snapshots (`"entra_id_group_maintenance"`) som mangler `type`-feltet.

**Obligatoriske felt i `snapshotAfter`:**

| Felt | Type | Beskrivelse |
|---|---|---|
| `type` | `string` | Aktivitetstypen brukt som snapshot-diskriminant (f.eks. `"oracle_role_criticality"`) |
| `schemaVersion` | `number` | Starter på `1`, økes ved breaking changes |
| `apiUnavailable` | `true` *(valgfri)* | Kun til stede (og alltid `true`) hvis M2M-API var utilgjengelig ved seed. Fraværende betyr API var tilgjengelig. *(målarkitektur)* |
| Type-spesifikke felt | varierer | Defineres per aktivitetstype (f.eks. `roles: OracleRoleEntry[]`) |

##### 2. KISS som primærkilde

Verdier som legges til grunn for en vedlikeholdsaktivitet hentes fra **KISS sin egen database** (applikasjonens gjeldende verdier), ikke direkte fra M2M-API-er ved oppstart. M2M-API-er brukes kun som supplement for å oppdage endringer siden siste gjennomgang.

##### 3. API-fletteprinsipp (new/gone-merging)

Verdier fra M2M-API flettes inn ved aktivitetsstart mot eksisterende KISS-verdier (etter matching-nøkkel):
- **Ny** (`is_new = true`): Finnes i M2M-API, men har ingen aktiv vurdering i KISS → markeres, må vurderes
- **Borte** (`is_gone = true`): Finnes i KISS, men returneres ikke av M2M-API → markeres `is_gone = true` og `is_new = false`
- **Eksisterende** (finnes i begge): Beholdes med gjeldende vurdering; `is_gone` settes eksplisitt til `false`

Fletteresultatet lagres i per-gjennomgang-tabellen og fryses for gjennomgangen.

**Reaktivering av tidligere arkiverte verdier:** Hvis en verdi har `archivedAt IS NOT NULL` i KISS OG returneres av M2M-API, presenteres den som `is_new = true` i per-gjennomgang-tabellen og **må vurderes på nytt**. Den gamle, arkiverte raden røres ikke og beholdes for historikk. **Ny rad opprettes i primærlagringen atomisk ved commit** (se prinsipp 6, steg 3).

**API utilgjengelig ved oppstart:** Hvis M2M-API ikke svarer, seedes aktiviteten utelukkende fra KISS sin primærlagring. Brukeren varsles tydelig i UI om at API-data mangler og at nye verdier ikke kan oppdages. `snapshotBefore` og `snapshotAfter` inkluderer `apiUnavailable: true` som metadata om seed-konteksten — dette lagres **kun i snapshotene**, ikke som egen kolonne på aktiviteten. Fullføring er likevel tillatt, og rapporten skal vise advarsel om degradert gjennomgang. *(Målarkitektur — ikke implementert i eksisterende aktivitetstyper.)*

##### 4. Arkivert + borte = utelatt fra nye gjennomganger

Verdier som er **arkiverte i KISS** (`archivedAt IS NOT NULL`) **og** ikke returneres av M2M-API, inkluderes ikke i nye gjennomganger. Aktive verdier som er borte i API flettes inn som «borte» og håndteres eksplisitt.

Hvis M2M-API er utilgjengelig ved aktivitetsstart, er «borte»-status ukjent — ingen verdier markeres da som `is_gone = true`, og ingen verdier arkiveres ved fullføring.

##### 5. Isolasjonsprinsipp

Under gjennomgangen skrives vurderinger **kun til per-gjennomgang-tabellen** (`routine_*`). Applikasjonens primærlagring oppdateres **ikke** underveis.

**Gjenopptakelse:** En pågående gjennomgang kan gjenopptas fritt — brukeren kan navigere bort og tilbake uten tap av data. Per-gjennomgang-tabellen bevarer alle vurderinger løpende. Det finnes ingen automatisk opprydding av ufullstendige gjennomganger.

**Én aktiv gjennomgang per aktivitetstype per applikasjon:** Systemet hindrer at to åpne gjennomganger av samme aktivitetstype eksisterer for samme applikasjon. `needs_follow_up`-status regnes som aktiv; `discarded`-status er ikke aktiv. Guard er implementert i `findActiveReviewConflict()` (`app/db/queries/routines.server.ts`) og kalles ved aktivitetsopprettelse i `gjennomgang.ny`-action. Seksjonsrutiner (`applicationId = null`) håndteres som egen scope.

##### 6. Atomisk commit ved fullføring

Alle vurderinger skrives til applikasjonens primærlagring i **én databasetransaksjon** når gjennomgangen fullføres (alt eller ingenting):
1. **Idempotenssjekk (krav):** Bruk conditional update (`WHERE status = 'pending'`). Returner suksess uten videre handling hvis aktiviteten allerede er `completed`.
2. Upsert eksisterende aktive verdier (`is_gone = false, is_new = false`) → primærlagring
3. Insert ny rad for reaktiverte verdier (`is_new = true` med matching-nøkkel tilsvarende arkivert rad) → primærlagring
4. Soft-delete borte verdier (`is_gone = true`) → sett `archivedAt`/`archivedBy` i primærlagringen
5. Lagre `snapshotAfter` med diskriminert union på aktiviteten (i samme transaksjon)
6. Marker aktiviteten som `completed`

**Idempotens:** Fullføring returnerer suksess uansett om aktiviteten allerede er `completed`. Kall nummer to er en no-op. Dette sikrer at nettverksfeil på klientsiden ikke fører til feil.

**`needs_follow_up`-status:** Hvis gjennomgangen har uadresserte oppfølgingspunkter når brukeren fullfører, settes gjennomgangens status til `needs_follow_up` i stedet for `completed`. **Alle vurderinger committes likevel til applikasjonens primærlagring** — verdiene er persistert og synlige i KISS. Videre oppfølging (retting av faktiske systemer, databaser, tilganger osv.) forventes gjort utenfor KISS. Gjennomgangens status oppdateres automatisk til `completed` når alle oppfølgingspunkter er adressert.

**Samtidighetsstrategi (last-write-wins):** Commit overskriver alltid gjeldende primærlagring. Det brukes ingen optimistic locking mellom seed og commit. Dette er et bevisst designvalg — isolasjonsprinsippet og regelen om én aktiv gjennomgang per aktivitetstype per app (se prinsipp 5) reduserer kollisjonssannsynligheten betraktelig.

##### 7. Fullføringskriterium

Fullføringsvalidering skjer mot **per-gjennomgang-tabellen alene**: alle rader der `is_gone = false` må ha en vurdering satt. Hva som utgjør en «vurdering» defineres per aktivitetstype (f.eks. `criticality IS NOT NULL` for Oracle-roller, `decision IS NOT NULL` for RPA).

#### Dataflyt — målarkitektur for nye vedlikeholdsaktivitetstyper

*Dette diagrammet beskriver målarkitekturen som alle nye vedlikeholdsaktivitetstyper skal implementere. Eksisterende typer (Entra, RPA) avviker — se avvikstabellen.*

```
Aktivitetsstart:
  [1] Ta snapshotBefore fra KISS primærlagring (FØR fletting, rene KISS-verdier)
      → inkluder apiUnavailable: true i snapshot hvis M2M-API er nede

  [2] Seed + flett:
    KISS-primærlagring (alle rader med archivedAt IS NULL)
    + M2M-API [hvis tilgjengelig] — normaliser + dedupliser matching-nøkkel
         ↓ (matching-nøkkel per aktivitetstype)
    routine_*_assessments: is_new / is_gone / eksisterende
    NB: Arkiverte KISS-verdier som returneres av API → is_new = true (ny rad ved commit)

Under gjennomgangen:
  → skriv kun til routine_*_assessments
  → gjennomgang kan gjenopptas fritt (ingen automatisk opprydding)
  → én aktiv gjennomgang per aktivitetstype per app (guard i `findActiveReviewConflict()`)

Fullføring (transaksjon):
  [1] activity.status === 'completed'? → returner suksess (idempotens)
  [2] Upsert aktive rader (is_gone = false, is_new = false) → primærlagring
  [3] Insert ny rad for reaktiverte verdier (is_new = true + arkivert matching-nøkkel) → primærlagring
  [4] Soft-delete borte rader (is_gone = true) → primærlagring
  [5] snapshotAfter { type, schemaVersion, [apiUnavailable] } → routine_review_activities
  [6] activity.status = 'completed'
      → review.status = 'needs_follow_up' (hvis uadresserte oppfølgingspunkter finnes)
      → review.status = 'completed' (ellers)

Rapport:
  routine_review_activities.snapshotBefore / snapshotAfter
       ↓ (discriminate on snapshot.type; fallback til activity.type for Entra legacy)
  Rapport — aldri live data; viser advarsel ved apiUnavailable: true
```

#### Sjekkliste for nye vedlikeholdsaktivitetstyper

Alle nye vedlikeholdsaktivitetstyper **skal** implementere følgende steg i rekkefølge:

1. Legg til aktivitetstypen i `ROUTINE_ACTIVITY_TYPES`, label og gruppe i `app/lib/activity-types.ts`
2. Verifiser/opprett **primærlagringstabell** i `app/db/schema/` med matching-nøkkel som partial unique index (`CREATE UNIQUE INDEX ... WHERE archived_at IS NULL`), vurderingsfelt, og audit-kolonner
3. Opprett **per-gjennomgang-tabell** `routine_{type}_assessments` med `review_id`, identitetsnøkkel (matching-nøkkel), vurderingsfelt, `is_new`, `is_gone`, og audit-kolonner. Legg til unik constraint på `(review_id, <matching-key-kolonner>)` og nødvendige indekser. (Oracle bruker kompositt: `(review_id, instance_id, role_name)`; enkle nøkler som Entras `group_id` bruker kun én kolonne.)
4. Definer matching-nøkkel som navngitt konstant i seed-funksjonen
5. Implementer seed-funksjon: ta `snapshotBefore` fra KISS (FØR fletting, alle rader med `archivedAt IS NULL` i kode / `archived_at IS NULL` i DB; valider at obligatoriske felt er satt og logg/varsle om ikke), hent M2M-API, normaliser og dedupliser matching-nøkkel fra API-input, flett (new/gone/existing), håndter `apiUnavailable` i snapshot, lagre i per-gjennomgang-tabell
6. Implementer save-action i gjennomgangsruten — skriv **kun** til `routine_*`-tabellen
7. Legg til aktivitetstype-spesifikk action-håndtering i gjennomgangsruten (intent-basert routing for save, complete og eventuelt skip/discard)
8. Implementer commit-funksjon i transaksjon: idempotenssjekk (`WHERE activity.status = 'pending'`), upsert aktive rader (`is_gone = false, is_new = false`), **insert ny rad for reaktiverte verdier** (`is_new = true` med matching-nøkkel tilsvarende arkivert rad), soft-delete borte rader, `snapshotAfter` med diskriminert union, sett `activity.status = 'completed'`
9. Implementer UI-stegkomponent som integreres i gjennomgangs-wizarden
10. Legg til snapshot-parsingstøtte i rapportgeneratoren for ny `snapshot.type`
11. Legg til aktivitetstypen i implementasjonsmatrisen under
12. Oppdater `expectedTables` i `migrations.integration.test.ts` med nye tabeller
13. Legg til idempotente migrasjoner for nye tabeller i `drizzle/`

#### Implementasjonsmatrise for vedlikeholdsaktiviteter

*Gjelder kun vedlikeholdsaktiviteter. Bevisaktiviteter vurderes ikke mot disse prinsippene — de følger en annen lagrings- og kjøremodell (se Oversikt over aktivitetstyper over).*

| Aktivitet | Isolasjon | API-fletting | Snapshot | Commit-tx |
|---|---|---|---|---|
| `oracle_role_criticality` *(planlagt)* | ✅ | ✅ | ✅ | ✅ |
| `rpa_user_maintenance` | ✅ | Ingen ekstern kilde ¹ | ✅ | ⚠️ Mangler |
| `entra_id_group_maintenance` | ⚠️ Avvik | Delvis | ✅ | ⚠️ Avvik |

¹ RPA har ingen ekstern M2M-kilde. Seed skjer kun fra KISS sin primærlagring. `is_new`/`is_gone` brukes ikke. Dette er et legitimt designvalg for aktivitetstyper uten ekstern datakilde, ikke et avvik fra prinsipp 3.

**RPA-avvik (tech debt):** RPA-vurderinger skrives ikke tilbake til primærlagring ved fullføring — det mangler app-nivå-tabell og commit-transaksjon. Refaktoreres separat.

**Entra-avvik (tech debt):** `set-group-criticality`, `add-manual-group` og `remove-manual-group` skriver direkte til `application_group_assessments` og `application_manual_groups` (app-nivå tabeller) under gjennomgangen (bryter prinsipp 5 og 6). Det finnes ingen ekte per-gjennomgang-tabell — fullføringsvalidering (prinsipp 7) skjer ikke mot seeded data. `routine_review_activity_entra_changes` er en endringslogg, ikke en seed-tabell. Snapshot tas ikke etter standard mønster. Refaktoreres separat.

#### Skillet mellom vedlikeholdsaktiviteter og bevisaktiviteter

**Vedlikeholdsaktiviteter** følger prinsippene 1–7. Per-gjennomgang-tabell seedes ved oppstart, vurderinger lagres kun der under gjennomgangen, og transaksjons-commit til primærlagring ved fullføring.
- Eksempler: `oracle_role_criticality`, `rpa_user_maintenance`, `entra_id_group_maintenance`

**Bevisaktiviteter** er arkitektonisk ulike. Brukeren laster ned revisjonsbevis fra et eksternt system. Ingen per-gjennomgang-tabell med vurderinger, ingen tilbakeskrivingstransaksjon. `snapshotBefore`/`snapshotAfter` brukes til bevismetadata (ikke vurderingsdata). Bevisfil lagres i GCS, metadata i provider-spesifikke tabeller (f.eks. `audit_evidence_snapshots` for Oracle).
- Eksempler: `oracle_evidence_roles`, `oracle_evidence_audit`, `deployment_evidence_report`
- Bruker `EvidenceSection`-komponenten og `EvidenceProvider`-interfacet

#### Sjekkliste for nye bevisaktivitetstyper

Nye bevisaktivitetstyper følger et annet mønster enn vedlikeholdsaktiviteter. Se `app/lib/evidence-providers/types.ts` for `EvidenceProvider`-interfacet:

0. Legg til ny provider-type i `EvidenceProviderType`-unionen i `app/lib/evidence-providers/types.ts`
1. Implementer `EvidenceProvider`-interfacet (`getStatus`, `downloadFile`) i `app/lib/evidence-providers/`
2. Registrer provideren i `app/lib/evidence-providers/index.server.ts` (`getEvidenceProvider(type)`)
3. Legg til UI-config i `app/lib/evidence-providers/ui-config.ts`: opprett ny `EvidenceProviderUiConfig`-blokk **og** legg til case i `getProviderUiConfig()`-funksjonen
4. Legg til aktivitetstypen i `ROUTINE_ACTIVITY_TYPES` og labelmap i `app/lib/activity-types.ts`
5. Utvid `EvidenceSection`-komponenten i `app/components/evidence/EvidenceSection.tsx` med ny case i switch-setningen (komponenten er exhaustive og gir kompileringsfeil ved manglende case)
6. Implementer lagring av evidence-metadata i provider-spesifikk tabell og sett `snapshotBefore`/`snapshotAfter` med type-spesifikk metadata
7. Implementer idempotent fullføring: sett `activity.status = 'completed'` (idempotenssjekk: `WHERE activity.status = 'pending'`). Re-download skal ikke opprette ny aktivitet.
8. Legg til idempotente migrasjoner for eventuelle nye provider-spesifikke tabeller i `drizzle/`

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
- **Persistering**: Oppdagede team og applikasjoner upsert-es til databasen med audit-logging
