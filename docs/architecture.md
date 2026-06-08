# Arkitektur — KISS

> Les denne filen når du skal forstå hvordan applikasjoner kobles til seksjoner, hvordan fillagring fungerer, eller hvordan Nais-synkronisering og bevisinnhenting er strukturert.

## Seksjon-app-tilhørighet

Applikasjoner er **IKKE** direkte knyttet til seksjoner via en `section_id`-kolonne på `monitored_applications`. Tilhørighet resolves indirekte via tre stier:

1. **Dev teams**: `application_team_mappings` → `dev_teams.section_id`
2. **NAIS teams**: `application_environments` → `nais_teams.section_id`
3. **Dev-NAIS mappinger**: `application_environments` → `dev_team_nais_team_mappings` → `dev_teams.section_id`

Canonical funksjoner i `app/db/queries/sections.server.ts`:
- `getEffectiveAppIdsInSection(sectionId)` — alle effektive app-IDer med filtrering (barn-apper, ignorerte, ekskluderte miljøer, arkiverte)
- `isAppEffectiveInSection(appId, sectionId)` — målrettet membership-sjekk for én app

**Viktig:** Opprett aldri en `section_id`-kolonne på `monitored_applications`. I integrasjonstester kobles apper til seksjoner via `dev_teams` + `application_team_mappings`.

## Lagringsabstraksjon (StorageProvider)

Fillagring bruker `StorageProvider`-interfacet i `app/lib/storage/`:

```ts
import { getStorageProvider } from "~/lib/storage/index.server"

const storage = getStorageProvider()
await storage.upload("reports/rapport-1.pdf", pdfBuffer, { contentType: "application/pdf" })
const data = await storage.download("reports/rapport-1.pdf")
```

- **Lokal utvikling**: Filer lagres i `.local-storage/` (gitignorert)
- **Produksjon**: Filer lagres i GCS bucket (`GCS_BUCKET_NAME`)
- Provider velges automatisk basert på `STORAGE_PROVIDER` env var (`local`/`gcs`)
- Støtter `uploadStream(path, Readable, options)` for streaming av store filer
- **Aldri** bruk `@google-cloud/storage` direkte — bruk alltid `getStorageProvider()`

## Bevisinnhenting (Evidence Providers)

Revisjonsbevis hentes fra eksterne systemer via provider-abstraksjon i `app/lib/evidence-providers/`:

```ts
import { getEvidenceProvider } from "~/lib/evidence-providers/index.server"

const provider = await getEvidenceProvider("oracle")
const status = await provider.getStatus({ instanceId: "PENSJON_PROD" })
const file = await provider.downloadFile({ instanceId: "PENSJON_PROD" }, "audit", "excel")
```

- **Registrerte providere**: `oracle` (pensjon-oracle-revisjon), `deployments` (NDA deployment-audit/leveranserapporter)
- **Aktivitetstype → provider**: `getProviderTypeForActivity()` i `activity-types.ts`
- **UI-config**: `getProviderUiConfig()` i `ui-config.ts` gir provider-spesifikke labels
- **API-ruter**: `/api/evidence-status`, `/api/evidence-download`, `/api/evidence-file/:downloadId`
- **Aldri** legg til Oracle-spesifikk logikk i generiske ruter — bruk provider-interfacet
- Nye providere implementeres som klasse som implementerer `EvidenceProvider`-interfacet

## Utgående HTTP-kall

Bruk `loggedFetch()` fra `app/lib/http-logger.server.ts` i stedet for native `fetch` for alle utgående HTTP-kall. Pass `{ area: "service-name" }` som tredje argument. Bruk aldri `fetch()` direkte i `.server.ts`-filer.

## Nais-plattform

Applikasjonen kjører på Nais med:
- CloudSQL PostgreSQL 18 (point-in-time recovery, audit logging)
- GCS Buckets (11 års retention, ingen sletting)
- Wonderwall for autentisering (Azure AD)
- Automatisk deploy via GitHub Actions

### Multi-pod og distribuert kjøring

KISS kjører med **flere podder i parallell**. Bakgrunnsjobber og langtids-operasjoner MÅ bruke advisory locks:

```ts
import { withAdvisoryLock } from "~/lib/lock.server"

const result = await withAdvisoryLock("my-job-name", async () => {
  return await doExpensiveWork()
})

if (result === null) {
  // En annen pod holder allerede låsen — hopp over
}
```

- Låser bruker `pg_try_advisory_lock` (ikke-blokkerende) og frigjøres i `finally`-blokk
- Ulike jobber bruker ulike låsnavn for uavhengig parallelitet
- Patch-operasjoner for vedlikeholdsaktiviteter bruker låsnavn `<activityType>-activity-<activityId>`

### Nais-synkronisering

KISS scanner Nais-plattformen for å oppdage team og applikasjoner:

- **Scheduler**: Periodisk synkronisering hvert 5. minutt (konfigurerbart via `ENABLE_NAIS_SYNC`)
- **Manuell trigger**: `POST /api/nais-sync` (krever autentisering)
- **GraphQL API**: Bruker Nais Console API (`NAIS_API_TOKEN`)
- **Låsemekanisme**: `nais-full-sync`, `nais-sync-teams`, `nais-sync-apps-{teamSlug}` advisory locks
- **Persistering**: Oppdagede team og applikasjoner upsert-es til databasen med audit-logging
