# Review-prompt: staged_data-vedlikeholdsaktiviteter

Supplement til `.github/copilot-instructions.md` — bruk denne ved review av PRer som
implementerer en ny vedlikeholdsaktivitetstype etter seed → patch → commit-mønsteret,
eller ved migrering av eksisterende aktiviteter til dette mønsteret.

De generelle reglene for audit-atomisitet, soft-delete og advisory locks er definert i
`.github/copilot-instructions.md`. Denne prompten dekker mønstre som er spesifikke for
`staged_data`-aktiviteter.

---

## 0. Design-first: sjekk dette FØR kodegjennomlesning

Krev svar på disse spørsmålene i PR-beskrivelsen eller i koden før du reviewer detaljer:

### 0.1 `staged_data`-dokumentets form er definert
- Har `activityType: string` og `schemaVersion: number` som toppnivå-felt (for fremtidig migrering)
- Har et navngitt array av elementer (f.eks. `items`, `users`, `groups`)
- Zod-schema er definert for hele dokumentet og for hvert element

### 0.2 Matching-nøkkel er valgt og dokumentert
- Stabil ekstern ID (ikke navn/label som kan endre seg)
- Dokumentert som navngitt konstant i seed-funksjonen
- Normaliseringsstrategi er definert (trim, casing, deduplisering)
- Stable sort på matching-nøkkel brukes ved lagring (krav for JSON.stringify no-op-deteksjon)

### 0.3 Patch-operasjoner er definert som exhaustiv union
```ts
type XxxStagedDataPatch =
  | { op: "add-item"; itemId: string; ... }
  | { op: "remove-item"; itemId: string }
  | { op: "set-status"; itemId: string; status: XxxStatus }
  // ... alle operasjoner
```
Ingen fall-through / catch-all branching.

### 0.4 Primærtabeller og commit-utfall er dokumentert
For hvert element-flagg: hva skal skje med primærtabellen ved commit?
- Nytt element (`isNew = true, isGone = false`) → INSERT
- Eksisterende element → UPDATE ved endring, SKIP ved uendret verdi
- Borte-element (`isGone = true`) → soft-delete (archivedAt/archivedBy)
- Reaktivert arkivert element → un-archive (archivedAt = null)
- Persisted-only element (finnes i KISS, ikke lenger i eksternt API) → beholdes som `isGone = true`

### 0.5 Audit-actions er lagt til i `auditLogActionEnum` FØR bruk
Sjekk `app/db/schema/audit.ts`. Alle planlagte actions (`xxx_activity_seeded`,
`xxx_activity_completed`, `xxx_item_changed`, osv.) skal finnes i enumen.

### 0.6 Change log vs audit log: ansvar er avklart
- **`audit_log`** — system-intern sporbarhet, alle CRUD-operasjoner, vises i admin-UI
- **`routine_review_activity_xxx_changes`** (eller tilsvarende) — brukervendt endringslogg
  som viser hva revieweren faktisk endret i løpet av gjennomgangen

Avklar om en separat endringslogg-tabell er nødvendig, eller om `audit_log` er tilstrekkelig.

---

## A. Seed-funksjonen (`seedXxxActivity`)

### A1. Eksternt API-kall skjer UTENFOR advisory lock
Kall til eksterne systemer (HTTP, Graph API, database-spørringer mot andre systemer)
**SKAL** skje *før* `withAdvisoryLock()` kalles. Begrunnelse: advisory lock holder en
DB-connection; eksterne kall kan ta sekunder og skaper lock-contention.

**Korrekt mønster (precheck → bygg → lock → re-sjekk → skriv):**
```ts
// 1. Precheck uten lock
const [precheck] = await db.select({ status, stagedData }).from(...).where(eq(...id)).limit(1)
if (!precheck) throw new Error("Aktivitet ikke funnet")
if (precheck.status !== "pending") throw new Response("Fullført", { status: 409 })
if (precheck.stagedData) return parseXxx(precheck.stagedData)  // already seeded

// 2. Bygg seed-resultat UTENFOR lock
const built = await buildXxxSeedResult(applicationId)  // API-kall her

// 3. Lock → re-sjekk → skriv
const lockName = `<activityType>-activity-${activityId}`
const result = await withAdvisoryLock(lockName, async () => {
  const [current] = await db.select({ status, stagedData }).from(...).where(eq(...id)).limit(1)
  if (current.stagedData) return parseXxx(current.stagedData)  // annen pod seeded

  return db.transaction(async (tx) => {
    const [updated] = await tx.update(...)
      .set({
        stagedData: built.stagedData,
        snapshotBefore: sql`COALESCE(${col.snapshotBefore}, ${JSON.stringify(built.snapshot)}::jsonb)`,
      })
      .where(and(eq(...id), isNull(col.stagedData)))
      .returning({ stagedData: col.stagedData })

    if (updated?.stagedData) {
      await writeAuditLog({ action: "xxx_activity_seeded", entityType: "routine_review_activity",
        entityId: activityId, performedBy }, tx)
      return parseXxx(updated.stagedData)
    }
    // Fallback: annen pod vant løpet
    const [current2] = await tx.select({ stagedData }).from(...).where(eq(...id)).limit(1)
    if (!current2?.stagedData) throw new Error("Seeding feilet")
    return parseXxx(current2.stagedData)
  })
})

// 4. Polling-fallback om lock ikke ble tatt
if (result !== null) return result
const polled = await waitForXxxSeed(activityId)
if (polled) return polled
throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
```

**Låsnavn-konvensjon:** `<activityType>-activity-<activityId>` (f.eks. `rpa_user_maintenance-activity-abc123`).

### A2. `snapshotBefore` — definisjon og COALESCE
`snapshotBefore` er et punkt-i-tid-snapshot av primærlagringen **før** gjennomgangen starter.
Brukes til å sammenligne "før" og "etter" i UI og rapporter.

- **SKAL** skrives atomisk i samme UPDATE som `stagedData`
- **SKAL** bruke `COALESCE` slik at eksisterende verdi ikke overskrives ved re-seed eller race:
  ```ts
  snapshotBefore: sql`COALESCE(${col.snapshotBefore}, ${JSON.stringify(snapshot)}::jsonb)`
  ```
- Snapshot-funksjonen er kanonisk — inkluder kun forretningsrelevante felt, ikke interne ID-er,
  operasjonell metadata (`seededAt`, actor-felter) eller tekniske artefakter

### A3. Seed er idempotent
- Tidlig return hvis `stagedData` allerede er satt (precheck + re-sjekk inne i lock)
- UPDATE bruker `WHERE staged_data IS NULL` — bare én pod skriver selv ved race
- Seed kalt to ganger gir identisk resultat (verifiser i integrasjonstest)

### A4. Status sjekkes FØR seeding
Hent og sjekk `status === "pending"` i precheck. Completed-aktiviteter skal aldri
få overskrevet `staged_data` eller `snapshotBefore`.

### A5. Audit-logging for seeding er atomisk
`writeAuditLog({ action: "xxx_activity_seeded", ... }, tx)` **SKAL** kalles i **samme
`db.transaction(tx)`** som UPDATE, og **kun** når UPDATE faktisk satte verdien
(sjekk `updated?.stagedData`). Seeding uten audit-logg er et brudd på repoets krav.

### A6. Normalisering av matching-nøkler
Alle string-nøkler fra eksterne API-er **SKAL** normaliseres før lagring:
```ts
// ❌ FEIL — tom streng bryter Zod-schema (min(1))
itemName: externalItem?.name

// ✅ RIKTIG
itemName: externalItem?.name?.trim() || null
```
Normaliser alle steder: ekstern kilde, manuell kilde, ghost-kilde (finnes kun i KISS).

### A7. Deterministisk rekkefølge og merge ved duplikater
- Bygg matching-nøkkel-map (`Map<itemId, entry>`) og merge alle datakilder til én rad per nøkkel
- Sorter resultat-arrayen på matching-nøkkel **før** lagring — krav for korrekt JSON.stringify no-op-deteksjon
- Ikke legg til nøkler med whitespace — filtrer *etter* trim

### A8. Fletteprinsipp for API-data vs KISS-data

> **Merk:** `isNew` og `isGone` er konseptuelle navn. Faktisk implementasjon kan bruke
> andre feltnavn (f.eks. `isNewAssessment`, `isAddedDuringReview`). Dokumenter valgt navn i 0.1.

| Tilstand | `isNew` (konsept) | `isGone` (konsept) |
|----------|--------------------|---------------------|
| Finnes i eksternt API, ingen aktiv rad i KISS | `true` | `false` |
| Finnes i KISS (aktiv vurdering), ikke i API | `false` | `true` |
| Finnes i begge | `false` | `false` |
| Arkivert i KISS OG returnert av API | `true` | `false` (reaktivering) |
| Finnes kun som manuelt lagt til | `true` | `false` |

**Rader som kun finnes i KISS** (ikke lenger returnert av eksternt API) **SKAL** inkluderes
i `staged_data` med `isGone = true` — de skal ikke droppes fra seed-resultatet.
Begrunnelse: commit trenger dem for å vite hvilke primærrad-rader som skal arkiveres.

### A9. Polling-fallback har tilstrekkelig ventetid
`waitForXxxSeed` må vente lenge nok til at eksternt API-kall rekker å fullføre.
Minimum: 4–10 sekunder (hensyn til API-latens, nettverksforsinkelse og backoff ved rate limiting).

---

## B. Patch-funksjonen (`patchXxxActivity`)

### B1. Seed-bygging UTENFOR lock (se A1)
Dersom `stagedData === null` og seeding trengs før patch, følg samme mønster som A1:
precheck → bygg seed-resultat utenfor lock → lock → re-sjekk (bruk eksisterende data
hvis annen pod seeded i mellomtiden) → skriv.

### B2. Seeding i patch audit-logges FØR wasNoOp-sjekk
Dersom patchen trigger seeding (fordi `stagedData` var null), **SKAL** seeding
audit-logges i transaksjonen **før** wasNoOp-sjekken:

```ts
// Rekkefølge inne i db.transaction(tx):
// 1. seed-UPDATE (hvis stagedData er null) → seededInThisCall = true
//    NB: seed-UPDATE SKAL også sette snapshotBefore med COALESCE (se A2)
// 2. patch-UPDATE (applyXxxStagedDataPatch)
// 3. writeAuditLog for seeding (hvis seededInThisCall) ← FØR wasNoOp
// 4. wasNoOp-sjekk → return tidlig hvis ingen endring i items
// 5. recordXxxChange (endringslogg for selve patchen)
```

Begrunnelse: wasNoOp-return hopper over endringslogg-kallet, men seeding SKAL alltid logges
uansett om patchen er en no-op.

### B3. No-op-deteksjon krever deterministisk rekkefølge
```ts
// ✅ RIKTIG — sammenlign kun items-arrayen, og kun når rekkefølge er deterministisk
const wasNoOp = JSON.stringify(stagedData.items) === JSON.stringify(updatedData.items)
```
Forutsetning: arrays er sortert på matching-nøkkel (se A7). Ustabil sortering gir false diffs.

### B4. `applyXxxStagedDataPatch` er exhaustiv
Alle operasjoner i patch-unionen **SKAL** ha eksplisitt gren og avslutte med exhaustiveness-check:
```ts
if (patch.op === "add-item") { ... }
else if (patch.op === "remove-item") { ... }
else if (patch.op === "set-status") { ... }
else { patch satisfies never }
```

### B5. `applyXxxStagedDataPatch` kan kaste vanlig `Error`
Fang **både** `Response` og `Error` fra patch-kallet:
```ts
try {
  updatedData = parseXxx(applyXxxStagedDataPatch(stagedData, patch))
} catch (e) {
  throw new Response(e instanceof Error ? e.message : "Ugyldig patch-operasjon", { status: 400 })
}
```

### B6. Lock-konflikt gir 409 `Response` fra query-laget
```ts
if (result === null) {
  throw new Response("Gjennomgangen er låst av en annen operasjon. Prøv igjen.", { status: 409 })
}
```
Kast `new Response(...)` — ikke `data(...)` fra `react-router` (tilhører route-laget).

### B7. Konsistente HTTP-statuskoder
| Situasjon | Status |
|-----------|--------|
| Lock-konflikt, allerede fullført, race-konflikt | **409** |
| Ugyldig input, validering feilet | **400** |
| Ressurs ikke funnet | **404** |

Ikke bruk 400 for «aktiviteten er allerede fullført» — det er en konflikttilstand → 409.

---

## C. Commit-funksjonen (`completeXxxReviewActivity`)

### C1. Advisory lock holdes gjennom hele commit + status-overgang
Sekvensen primærtabell-writes → `snapshotAfter` → `status = "completed"` **SKAL** skje
innenfor samme `withAdvisoryLock`-callback. En parallell `patchXxxActivity` kan ellers
endre `staged_data` i vinduet mellom commit og status-oppdatering.

### C2. Alt i én `db.transaction(tx)`
Hele commit-sekvensen **SKAL** være atomisk:
- Upsert/arkivering i primærtabeller
- `snapshotAfter`-skriving (kanonisk snapshot-funksjon, se A2)
- `status = "completed"`
- `writeAuditLog`

### C3. Status-overgang er betinget og konflikt-sikker
```ts
// ✅ RIKTIG — betinget UPDATE forhindrer dobbel-commit
const [updated] = await tx.update(routineReviewActivities)
  .set({ status: "completed", snapshotAfter: ... })
  .where(and(eq(col.id, activityId), eq(col.status, "pending")))
  .returning({ id: col.id })

if (!updated) {
  throw new Response("Aktiviteten er allerede fullført", { status: 409 })
}
```

### C4. Borte-elementer soft-deletes
Elementer med `isGone = true` **SKAL** arkiveres i primærtabellene:
```ts
.set({ archivedAt: new Date(), archivedBy: performedBy })
```
Hard delete (`db.delete(...)`) er forbudt.

### C5. Reaktivering av arkiverte primærrad-rader
Dersom et element er aktivt i `staged_data` men primærraden er arkivert, **SKAL**
`archivedAt`/`archivedBy` nullstilles — ikke ignoreres. Ellers vil neste seed
se elementet som «uten aktiv vurdering» og behandle det som nytt.

### C6. Alle lookup-queries på primærtabeller filtrerer aktive rader
Både read- og write-operasjoner (upsert, update, select for comparison) **SKAL**
inkludere `WHERE archived_at IS NULL` der tabellen har soft-delete:
```ts
// ❌ FEIL — kan returnere arkivert rad
const [row] = await tx.select().from(tabell).where(eq(tabell.itemId, itemId)).limit(1)

// ✅ RIKTIG
const [row] = await tx.select().from(tabell)
  .where(and(eq(tabell.itemId, itemId), isNull(tabell.archivedAt))).limit(1)
```

### C7. Partial unique index for aktive rader i primærtabell
```sql
-- ✅ RIKTIG — tillater ny aktiv rad etter arkivering
CREATE UNIQUE INDEX ... ON tabell (app_id, item_id) WHERE archived_at IS NULL;

-- ❌ FEIL — gir insert-feil ved reaktivering
ALTER TABLE tabell ADD CONSTRAINT ... UNIQUE (app_id, item_id);
```

### C8. Commit-filter er komplett
Filteret for hvilke elementer som skrives ved commit **SKAL** inkludere alle relevante flagg.
Dokumenter predikatet eksplisitt i koden. Eksempel (for manuelt tillagte elementer):
```ts
// Mangler hasManualSource → kan inserte rad som aldri ble lagt til manuelt
const toInsert = items.filter(i => i.isAddedDuringReview && !i.isGone)          // ❌
const toInsert = items.filter(i => i.isAddedDuringReview && i.hasManualSource && !i.isGone) // ✅
```

### C9. Unngå unødvendig churn i primærtabeller
Sammenlign eksisterende og ny verdi **før** UPDATE — skip skriving hvis identisk.
Begrunnelse: unødvendige writes gir audit-støy og øker I/O.

### C10. Audit bruker DB-verdier fra `.returning()`, ikke `staged_data`
`staged_data` kan ha blitt endret under gjennomgangen. Hent `previousValue` fra
`.returning(...)` på UPDATE/arkivering:
```ts
const archived = await tx.update(tabell)
  .set({ archivedAt: now, archivedBy: performedBy })
  .where(...)
  .returning({ id: tabell.id, status: tabell.status, assessedBy: tabell.assessedBy })

await writeAuditLog({
  action: "xxx_item_archived",
  previousValue: JSON.stringify({ status: archived[0].status, assessedBy: archived[0].assessedBy }),
  ...
}, tx)
```

### C11. Commit-path trigges på `type`, ikke på `stagedData !== null`
Entra/Xxx-commit-path **SKAL** trigges basert på `activity.type === "<aktivitetstype>"`,
ikke på `activity.stagedData !== null`. Seeding håndteres inne i commit-funksjonen om nødvendig.
Begrunnelse: legacy-rader har `stagedData === null` men er fortsatt av korrekt type.

### C12. Seeding ved commit audit-logges
Hvis `completeXxxReviewActivity` seeder `staged_data` (legacy-rader), **SKAL** seeding
audit-logges atomisk i samme transaksjon (se A5).

### C13. Fallback-seeding i commit gjør IKKE eksterne kall under lock/tx
Dersom commit seeder, **SKAL** seed-resultatet bygges *utenfor* advisory lock og/eller
*utenfor* `db.transaction`. Eksternt API-kall inne i lock/tx blokkerer connection-pool
og gir økt konfliktfare. Dokumenter eksplisitt i koden hvis dette unntaksvis ikke er mulig,
og begrunn hvorfor det er akseptabelt.

---

## D. Route-laget (action-handlers og loadere)

### D1. Alle action-branches fanger `Response` fra seed/patch/commit
```ts
try {
  await patchXxxActivity(activityId, patch, performedBy)
} catch (e) {
  if (e instanceof Response) {
    const error = e.status === 409
      ? "Gjennomgangen er låst av en annen operasjon. Prøv igjen."
      : await e.text()
    return data<ActionResult>({ success: false, error, intent }, { status: e.status })
  }
  throw e
}
```

### D2. Eksplisitt sjekk av `e.status === 409` — ikke alt er lås-konflikt
`patchXxxActivity` kan kaste 400 (ugyldig operasjon), 404 (ikke funnet) og 409 (konflikt).
Map til korrekt feilmelding basert på status.

### D3. Valider required foreign keys i query-laget — ikke bare i action
Aktivitetstyper som krever `applicationId` (eller annen FK) **SKAL** validere dette
i query-funksjonen:
```ts
if (!applicationId) throw new Response("Aktiviteten mangler applikasjon", { status: 400 })
```
I tillegg kan action gjøre en tidlig sjekk for bedre UX.

### D4. Server-side validering FØR patch
Valider at operasjonen er lovlig på serversiden (isGone, kildeflagger, tilstand)
før `patchXxxActivity` kalles. `applyXxxStagedDataPatch` kaster `Error` (ikke `Response`)
for ulovlige operasjoner — disse fanges ikke i action uten eksplisitt catch.

### D5. `performedBy` og tidsstempler settes server-side
```ts
// ❌ FEIL — stol aldri på klientdata for actor/tid
const performedBy = requestBody.performedBy

// ✅ RIKTIG
const performedBy = authedUser.navIdent  // fra autentisert kontekst
```
Tidsstempler settes med `new Date()` server-side — aldri fra payload.

### D6. Loader: håndter 409 fra seed eksplisitt
```ts
try {
  stagedData = await seedXxxActivity(activityId, applicationId, "system")
} catch (err) {
  if (err instanceof Response && err.status === 409) {
    // Vis «Seeding pågår — last siden på nytt» fremfor generisk feil
    actXxxData = { error: "seeding_in_progress" }
  } else {
    throw err
  }
}
```

---

## E. Schema og typing

### E1. `staged_data`-kolonnen er generisk
`routineReviewActivities.stagedData` **SKAL** types som `Record<string, unknown> | null` —
ikke som en aktivitetsspesifikk type. Parse til riktig type etter henting med aktivitetens
Zod-schema.

### E2. `staged_data`-dokumentet har `activityType` og `schemaVersion`
Krav for fremtidig migrering og versjonshåndtering.

### E3. Zod-schema validerer på alle paths
`parseXxx(stagedData)` **SKAL** kalles ved alle lese-operasjoner og ved skriving.
Reviewer bør sjekke at umulige tilstander fanges av Zod-schema — ikke bare av applikasjonslogikk.

Bruk `superRefine` for kryss-felt-invarianter som ikke kan uttrykkes med enkelt-felt-validering:
```ts
// Eksempel: isGone kan ikke kombineres med isNew
.superRefine((data, ctx) => {
  if (data.isGone && data.isNew) {
    ctx.addIssue({ code: "custom", message: "isGone og isNew kan ikke begge være true" })
  }
})
```
Duplikate matching-nøkler og inkonsistente kilde-flagg er typiske kandidater for `superRefine`.

### E4. Komponent-props bruker spesifikke union-typer
Props til React-komponenter **SKAL** bruke spesifikke typer (f.eks. `XxxStatus | null`)
— ikke `string | null` som krever casts og mister compile-time sikkerhet.

---

## F. Endringslogg (change log)

> Gjelder kun hvis det er besluttet å ha en brukervendt endringslogg (se 0.6).
> Dersom `audit_log` er tilstrekkelig, kan denne seksjonen hoppes over.

**Definisjon:** Endringslogg er brukervendt historikk over hva revieweren endret i løpet
av gjennomgangen. Skiller seg fra `audit_log` (system-intern sporbarhet):

| | `audit_log` | Endringslogg |
|-|------------|--------------|
| Målgruppe | Admin, system | Reviewer, seksjonsleder |
| Vises i | Admin-UI | Gjennomgangs-UI |
| Innhold | Alle CRUD-operasjoner | Kun review-endringer |

### F1. Endringslogg skrives i query-laget i samme transaksjon som patch
`recordXxxChange(...)` **SKAL** kalles inne i `db.transaction(tx)` i patch-funksjonen —
ikke i route-laget etter at funksjonen returnerer.

### F2. No-op gir ingen endringslogg
Skriv endringslogg kun når `staged_data` faktisk endres (se B3 — JSON.stringify etter deterministisk sortering).

### F3. Actor i endringslogg matcher faktisk utfører
`performedBy` i endringslogg og audit **SKAL** alltid matche hvem som utførte operasjonen
på det tidspunktet (autentisert bruker eller `"system"`). Ikke bruk gammel vurdering (`assessedBy` fra earlier patch).

---

## G. Migrering av eksisterende aktivitetstype

Gjelder ved migrering av en aktivitetstype som allerede har data i produksjon (f.eks. `rpa_user_maintenance`).

### G1. Eksisterende primærdata bevares i `staged_data` som `isGone = true`
Rader i primærtabellene som ikke lenger finnes i eksternt API **SKAL** inkluderes i
`staged_data` med `isGone = true`. De skal ikke droppes fra seed-resultatet.

### G2. Legacy snapshot-parsing er korrekt
Dersom `snapshotBefore`/`snapshotAfter` fra eldre gjennomganger har et annet format,
**SKAL** parseringen håndtere dette eksplisitt — ikke gjette på formatet.
Spesifikt: sørg for at `isGone`-semantikk i legacy-format mappes korrekt (f.eks. `source: "removed"` er
ikke nødvendigvis `isGone = true` i ny semantikk).

### G3. Commit er duplicate-safe mot eksisterende data
Commit **SKAL** aldri forutsette tom primærtabell. Bruk upsert-mønster:
- INSERT med `onConflictDoUpdate` for å reaktivere arkiverte rader
- Eller: SELECT eksisterende + betinget INSERT/UPDATE

### G4. Legacy commit-seeding bruker ikke eksterne kall under lock/tx
Dersom commit-funksjonen seeder for legacy-rader (uten `staged_data`), verifiser at
`buildXxxSeedResult` (API-kall) skjer **utenfor** advisory lock og `db.transaction`.

---

## H. Integrasjonstester

### H1. Alle tre faser har integrasjonstest
- **Seed**: verifiser `staged_data`, `snapshotBefore`, og at seeding er idempotent
- **Patch**: verifiser at `staged_data` endres korrekt for alle patch-operasjoner
- **Commit**: verifiser at primærtabeller oppdateres, `snapshotAfter` settes,
  og at status blir `"completed"`

### H2. Idempotens er testet
- Seed kalt to ganger → identisk `staged_data`
- Patch med no-op → `staged_data` uendret, ingen endringslogg
- Commit kalt to ganger → andre kall gir 409 (ikke kræsj)

### H3. Feiltilfeller er testet
- Seed på fullført aktivitet → 409
- Patch med ugyldig operasjon → 400
- Patch på fullført aktivitet → 409
- Commit uten at alle påkrevde felt er satt → 400

### H4. Borte-elementer og reaktivering er testet
- Element markert `isGone = true` → soft-delete i primærtabell ved commit
- Arkivert rad i primærtabell → reaktiveres korrekt ved ny gjennomgang

### H5. Alle patch-operasjoner har enhetstest i `applyXxxStagedDataPatch`
Inkluder test for ugyldig operasjon (element som ikke finnes, element i feil tilstand).

---

## I. Logging

### I1. Send `Error`-instansen direkte til logger
```ts
// ❌ FEIL — stack trace logges ikke (loggeren henter kun stack fra Error-instansen)
logger.error("Feil ved seeding", { error: err })

// ✅ RIKTIG
logger.error("Feil ved seeding", err)
```

---

## Hurtigsjekkliste

Merket med `[M]` = kun aktuelt ved migrering, `[T]` = kan ikke verifiseres fra diff alene (krever kjøring).

```
DESIGN
[ ] staged_data-dokument har activityType og schemaVersion
[ ] Matching-nøkkel er stabil ekstern ID, dokumentert som konstant
[ ] Faktisk feltnavn for isNew/isGone er dokumentert i 0.1 (ikke kun konseptuelt)
[ ] Patch-union er exhaustiv (ingen catch-all)
[ ] Audit-actions lagt til i auditLogActionEnum FØR bruk

SEED
[ ] buildXxxSeedResult kalles UTENFOR withAdvisoryLock
[ ] Låsnavn følger konvensjonen <activityType>-activity-<activityId>
[ ] Re-sjekk av staged_data skjer INNE I lock (etter bygging)
[ ] snapshotBefore bruker COALESCE — overskrives aldri
[ ] seed-UPDATE bruker WHERE staged_data IS NULL
[ ] status === "pending" sjekkes FØR seeding
[ ] Matching-nøkler normaliseres (.trim() || null)
[ ] Arrays sorteres deterministisk på matching-nøkkel
[ ] Duplikate nøkler merges (Map-mønster)
[ ] Rader som kun finnes i KISS (ikke i API) inkluderes som isGone = true
[ ] [T] waitForXxxSeed venter 4–10 sekunder (hensyn til API-latens)

AUDIT / ATOMISITET
[ ] writeAuditLog kalles i SAMME db.transaction som alle DB-mutasjoner
[ ] Seeding audit-logges uansett kaller (seed/patch/commit)
[ ] Seeding-audit logges FØR wasNoOp-sjekk i patch
[ ] performedBy settes fra autentisert kontekst, ikke klientpayload

PATCH
[ ] applyXxxStagedDataPatch er exhaustiv (patch satisfies never)
[ ] Error fra applyXxx fanges og konverteres til Response (400)
[ ] Lock-konflikt gir 409 Response fra query-laget
[ ] Ingen bruk av data(...) fra react-router i query-laget
[ ] [T] No-op gir ingen endringslogg (JSON.stringify etter deterministisk sortering)
[ ] Endringslogg skrives i query-laget, ikke i route

COMMIT
[ ] Lock holdes gjennom hele commit + status-overgang
[ ] Alt i én db.transaction (primærtabell + snapshotBefore + snapshotAfter + status + audit)
[ ] snapshotAfter skrives atomisk i commit-transaksjonen (ikke separat UPDATE etterpå)
[ ] Status-UPDATE er betinget (WHERE status = 'pending') og håndterer 0 rader → 409
[ ] isGone-elementer soft-deletes (archivedAt/archivedBy)
[ ] [T] Arkiverte primærrad-rader reaktiveres (archivedAt = null) ved ny gjennomgang
[ ] Alle lookup-queries filtrerer på archived_at IS NULL
[ ] Partial unique index for aktive rader i primærtabell
[ ] Commit-filter inkluderer alle relevante flagg (isAdded, hasSource, !isGone)
[ ] Ingen unødvendig churn (sammenlign før/etter)
[ ] previousValue i audit hentes fra .returning(), ikke staged_data
[ ] Commit-path trigges på activity.type, ikke staged_data !== null
[ ] Fallback-seeding i commit gjør ikke eksterne kall under lock/tx

ROUTE-LAGET
[ ] Alle action-branches fanger Response fra seed/patch/commit
[ ] e.status === 409 sjekkes eksplisitt (ikke alt er lås-konflikt)
[ ] FK-validering (applicationId o.l.) skjer i query-laget
[ ] Loader håndterer 409 fra seed eksplisitt (ikke generisk feil)

SCHEMA / TYPING
[ ] staged_data-kolonne er Record<string, unknown> | null
[ ] Zod-schema validerer alle reads og writes
[ ] Zod superRefine brukes for kryss-felt-invarianter
[ ] Komponent-props bruker spesifikke union-typer

MIGRERING
[ ] [M] Commit er duplicate-safe mot eksisterende data (upsert-mønster)
[ ] [M] Legacy snapshot-format håndteres eksplisitt i parsing

TESTER
[ ] Alle tre faser (seed/patch/commit) har integrasjonstest
[ ] [T] Idempotens testet for seed, patch (no-op), commit
[ ] Feiltilfeller testet (409, 400, 404)
[ ] [T] isGone/reaktivering testet i commit
[ ] Alle patch-ops har enhetstest i applyXxxStagedDataPatch

LOGGING
[ ] logger.error kaller sendes Error-instansen direkte (ikke { error: err })
```
