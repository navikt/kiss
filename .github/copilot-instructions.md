# GitHub Copilot — PR-reviewinstruksjoner for KISS

Denne filen gir GitHub Copilot kontekst for kode-review av PRer mot dette repoet.
Se `AGENTS.md` for fullstendig arkitekturdokumentasjon.

## Kritiske sjekkpunkter (blokkér PR ved avvik)

### 1. Audit-atomisitet — writeAuditLog MÅ stå i samme transaksjon som DB-mutasjonen

Ethvert kall til `writeAuditLog()` som skjer etter en DB-mutasjon (insert/update/delete)
**SKAL** bruke `tx`-parameteren og begge kall **SKAL** ligge inne i `db.transaction()`.

```ts
// ❌ FEIL — ikke atomisk. Hvis writeAuditLog kaster, er DB endret uten sporbarhet
await db.update(tabell).set({ ... })
await writeAuditLog({ action: "...", ... })

// ✅ RIKTIG — atomisk
return db.transaction(async (tx) => {
  await tx.update(tabell).set({ ... })
  await writeAuditLog({ action: "...", ... }, tx)
})
```

Dette gjelder i alle query-funksjoner i `app/db/queries/`. Sjekk spesielt:
- Funksjoner som gjør `db.update()` eller `db.insert()` etterfulgt av `writeAuditLog()`
- Hjelpefunksjoner som inserter i endringslogg-tabeller + kaller `writeAuditLog()`

### 2. Audit-logging påkrevd for alle CRUD-operasjoner

Alle ny opprettelse, endring og sletting **SKAL** kalle `writeAuditLog()` fra `app/db/queries/audit.server.ts`.

Obligatoriske felt i audit-kallet:
- `action` — må finnes i `auditLogActionEnum` i `app/db/schema/audit.ts`
- `entityType` — f.eks. `"application"`, `"routine_review_activity"`
- `entityId` — primærnøkkelen til entiteten
- `previousValue` — ved endring/sletting (JSON.stringify av gammel verdi)
- `newValue` — ved opprettelse/endring (JSON.stringify av ny verdi)
- `performedBy` — nav-ident til utførende bruker

Nye `action`-verdier **SKAL** legges til i `auditLogActionEnum` i `app/db/schema/audit.ts`
**FØR** de brukes i query-kode.

### 3. Historikkbevaring — ingen hard delete

Data skal aldri slettes med `db.delete()` fra primærtabeller. Bruk alltid soft-delete:

```ts
// ❌ FEIL
await db.delete(tabell).where(eq(tabell.id, id))

// ✅ RIKTIG
await db.update(tabell)
  .set({ archivedAt: new Date(), archivedBy: performedBy })
  .where(eq(tabell.id, id))
```

Unntak: sletting av rader som aldri har vært eksponert for brukere (f.eks. staging-rader
som rulles tilbake pga. valideringsfeil).

### 4. Audit-kolonner på nye tabeller

Alle nye tabeller **SKAL** ha disse fire kolonnene:
```ts
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
createdBy: text("created_by").notNull(),
updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
updatedBy: text("updated_by").notNull(),
```

### 5. Advisory locks for operasjoner som kjøres på tvers av pods

Periodiske jobber, seed-operasjoner og langvarige commit-operasjoner **SKAL** bruke
`withAdvisoryLock()` fra `app/lib/lock.server.ts`. Returverdien **SKAL** sjekkes:

```ts
const result = await withAdvisoryLock(lockName, async () => {
  // ...
})
if (result === null) {
  // En annen pod holder låsen — ikke kast ukategorisert feil
  throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
}
```

Låsnavn skal følge konvensjonen `<aktivitetstype>-activity-<activityId>`.

---

## Viktige sjekkpunkter

### 6. Idempotente migrasjoner

SQL-migrasjoner i `drizzle/` **SKAL** bruke idempotent DDL:
```sql
ADD COLUMN IF NOT EXISTS ...
DROP COLUMN IF EXISTS ...
CREATE TABLE IF NOT EXISTS ...
DROP CONSTRAINT IF EXISTS ...
CREATE UNIQUE INDEX IF NOT EXISTS ...
```

Sjekk `drizzle/meta/_journal.json` at ny migrasjon er lagt til med riktig sekvens.

### 7. Statiske imports i .server.ts-filer

`.server.ts`-filer **SKAL** bruke statiske imports for alle kjente avhengigheter.
Dynamisk `await import(...)` er kun tillatt for å bryte sirkulære avhengigheter:

```ts
// ❌ FEIL — unødvendig dynamisk import
const { getManualGroupsForApp } = await import("./nais.server")

// ✅ RIKTIG — statisk import øverst i filen
import { getManualGroupsForApp } from "./nais.server"
```

### 8. Server-only kode i .server.ts-filer

Kode som bruker `db`, `writeAuditLog`, `withAdvisoryLock`, eller gjør HTTP-kall
mot interne systemer **SKAL** ligge i filer med `.server.ts`-suffiks.

Kode importert fra `.server.ts` kan **ikke** brukes i JSX-komponenter direkte
(React Router fjerner `.server`-imports kun fra `loader`/`action`/`headers`).

### 9. Forretningsinvarianter i query-laget

Domene-invarianter (f.eks. «alle aktive grupper SKAL ha kritikalitet»,
«seksjonsrutiner SKAL ha appliesToAllInSection = true») **SKAL** håndheves
i `app/db/queries/`-funksjonene — ikke bare i route-action-kode.

```ts
// ❌ FEIL — validering kun i action, ikke i query-funksjonen
// (action vet, men neste utvikler som kaller query-funksjonen gjør det kanskje ikke)

// ✅ RIKTIG — query-funksjonen håndhever invarianten selv
export async function createRoutine(params: CreateRoutineParams) {
  if (params.isSectionRoutine) {
    params.appliesToAllInSection = true  // invariant håndhevet her
    params.activityType = null
  }
  // ...
}
```

### 10. Valgfrie parametere i update-funksjoner skal ikke resette verdier

```ts
// ❌ FEIL — params.isSectionRoutine ?? false evaluerer til false ved undefined
await db.update(routines).set({
  appliesToAllInSection: params.isSectionRoutine ? 1 : 0
})

// ✅ RIKTIG — kun inkluder feltet hvis det er eksplisitt oppgitt
await db.update(routines).set({
  ...(params.isSectionRoutine !== undefined && {
    appliesToAllInSection: params.isSectionRoutine ? 1 : 0
  })
})
```

### 11. Endringslogg skal vises i brukergrensesnittet

Sider som er knyttet til entiteter der CRUD-operasjoner skjer **SKAL** vise
en endringslogg med disse kolonnene (bruk Aksel `<Table>`):

| Tidspunkt | Handling | Detaljer | Utført av |

---

## TypeScript-mønstre

### 12. Null-filtrering med type guard

```ts
// ❌ FEIL — snevrer ikke typen i strict mode
const result = items.filter(x => x !== null)

// ✅ RIKTIG — type guard
const result = items.filter((x): x is NonNullable<typeof x> => x !== null)
```

### 13. Ikke bruk complianceAssessments eller complianceAssessmentHistory

Disse tabellene er **DEPRECATED**. Bruk ikke i nye funksjoner. Compliance-status
skal utledes fra `screeningAnswers`, `rulesetControls` og `routineControls`.

---

## Vedlikeholdsaktiviteter (staged_data-mønsteret)

Nye vedlikeholdsaktivitetstyper (`oracle_role_criticality`, fremtidige typer) **SKAL** følge
seed → patch → commit-mønsteret. Sjekk at en ny aktivitetstype:

- [ ] Bruker `staged_data JSONB` på `routine_review_activities` — ikke en ny tabell per aktivitetstype
- [ ] Har `activityType` og `schemaVersion` som toppnivå-felt i `staged_data`-dokumentet
- [ ] Lagrer `snapshotBefore` atomisk ved seed (samme DB-kall)
- [ ] Lagrer `snapshotAfter` atomisk ved commit (i commit-transaksjonen)
- [ ] Bruker `withAdvisoryLock()` med låsnavn `<activityType>-activity-<activityId>` for patch-operasjoner
- [ ] Seed er idempotent — returnerer eksisterende data uten ny skriving hvis allerede satt
- [ ] Commit er idempotent — returnerer suksess uten videre handling hvis aktiviteten allerede er `completed`
- [ ] Fullføringsvalidering skjer mot `staged_data` (ikke primærlagring)
- [ ] Borte-verdier (`is_gone = true`) arkiveres (soft-delete) ved commit — aldri hard-delete
- [ ] `staged_data` beholdes etter commit — slettes aldri
- [ ] Matching-nøkkel er dokumentert med navngitt konstant i seed-funksjonen
- [ ] Matching-nøkkel normaliseres (trim, casing) og dedupliseres i seed-funksjonen

### API-fletteprinsipp

| Tilstand | `is_new` | `is_gone` |
|----------|----------|-----------|
| Finnes i M2M-API, ingen aktiv vurdering i KISS | `true` | `false` |
| Finnes i KISS, ikke returnert av M2M-API | `false` | `true` |
| Finnes i begge | `false` | `false` |
| Arkivert i KISS OG returnert av M2M-API | `true` | `false` (reaktivering) |

---

## Nye ruter

- [ ] Ruten er lagt til i `app/routes.ts` FØR rutefilen opprettes
- [ ] Alle `redirect()`-kall bruker absolutte stier (f.eks. `/seksjoner/${id}/rutiner`)
- [ ] Alle `<Link to="...">` og `href="..."`-attributter peker til registrerte ruter
- [ ] Relative lenker (`./`, `../`) er verifisert mot rutens mønster i `routes.ts`

<!-- rtk-instructions v2 -->
# RTK — Token-Optimized CLI

**rtk** is a CLI proxy that filters and compresses command outputs, saving 60-90% tokens.

## Rule

Always prefix shell commands with `rtk`:

```bash
# Instead of:              Use:
git status                 rtk git status
git log -10                rtk git log -10
cargo test                 rtk cargo test
docker ps                  rtk docker ps
kubectl get pods           rtk kubectl pods
```

## Meta commands (use directly)

```bash
rtk gain              # Token savings dashboard
rtk gain --history    # Per-command savings history
rtk discover          # Find missed rtk opportunities
rtk proxy <cmd>       # Run raw (no filtering) but track usage
```
<!-- /rtk-instructions -->