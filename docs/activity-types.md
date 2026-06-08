# Aktivitetstyper i KISS

> Les denne filen når du skal implementere en ny vedlikeholdsaktivitetstype eller bevisaktivitetstype.
> For detaljert implementasjonsveiledning for `staged_data`-mønsteret, se [`docs/staged-data-pattern.md`](staged-data-pattern.md).

## Oversikt

Det finnes to arkitektonisk ulike kategorier aktivitetstyper:

| Aktivitetstype | Kategori | Arbeidsformat | Commit til primærlagring | Status |
|---|---|---|---|---|
| `oracle_role_criticality` | Vedlikehold | `staged_data JSONB` | Ja | 🔲 Planlagt |
| `rpa_user_maintenance` | Vedlikehold | `staged_data JSONB` + commit til `routine_rpa_user_assessments` | Ja | ✅ Implementert |
| `entra_id_group_maintenance` | Vedlikehold | `staged_data JSONB` | Ja | ✅ Implementert |
| `oracle_evidence_audit` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_profiles` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_roles` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_users` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_period` | Bevis | Ingen | Nei | ✅ Implementert |
| `oracle_evidence_all` | Bevis | Ingen | Nei | ✅ Implementert |
| `deployment_evidence_report` | Bevis | Ingen | Nei | ✅ Implementert |

**Vedlikeholdsaktiviteter** følger prinsippene beskrevet under og i `staged-data-pattern.md`.
**Bevisaktiviteter** er arkitektonisk ulike — brukeren laster ned revisjonsbevis fra et eksternt system. Ingen `staged_data` med vurderinger. Bevisfil lagres i GCS, metadata i provider-spesifikke tabeller.

---

## Prinsipper for vedlikeholdsaktiviteter

Disse prinsippene er **bindende krav for alle nye vedlikeholdsaktivitetstyper**.

### Begrepsdefinisjoner

- **`is_gone = true`**: Verdien ble ikke returnert av M2M-API ved aktivitetsstart. Lagres kun i `staged_data`.
- **`archivedAt IS NOT NULL`**: Verdien er soft-deleted i KISS primærlagring.
- **Aktiv vurdering i KISS**: Rad med `archivedAt IS NULL` og obligatoriske vurderingsfelt satt.
- **Matching-nøkkel**: Nøkkel som avgjør at én verdi i KISS og én fra M2M-API er «samme verdi». Dokumenteres med navngitt konstant i seed-funksjonen. Skal normaliseres (trim, casing) og dedupliseres.

### 1. Snapshot-prinsipp

Resultater lagres som uforanderlige snapshots (`snapshotBefore`/`snapshotAfter`) på `routine_review_activities`. Rapporten skal alltid reflektere tilstanden slik den var da gjennomgangen ble gjennomført.

- `snapshotBefore`: KISS-tilstand **før** API-fletting, lagres atomisk ved seed.
- `snapshotAfter`: Endelig tilstand etter commit, lagres i **samme transaksjon** som commit.

**Snapshot-format (målarkitektur):**
```typescript
type ReviewSnapshot =
	| { type: "oracle_role_criticality"; schemaVersion: 1; apiUnavailable?: true; roles: OracleRoleEntry[] }
	| { type: "oracle_evidence_audit"; schemaVersion: 1; evidenceType: string; collectedAt: string; bucketPath: string }
	// Legacy Entra: { groups: EntraGroupEntry[] } — mangler type og schemaVersion
```

Alle nye snapshots skal ha `type` (= aktivitetstypen) og `schemaVersion: 1`. Parser skal falle tilbake til `activity.type` kun for legacy Entra-snapshots.

### 2. KISS som primærkilde

Verdier hentes fra KISS sin egen database, ikke direkte fra M2M-API. API brukes kun som supplement for å oppdage endringer siden siste gjennomgang.

### 3. API-fletteprinsipp (new/gone-merging)

| Tilstand | `is_new` | `is_gone` |
|---|---|---|
| Finnes i M2M-API, ingen aktiv vurdering i KISS | `true` | `false` |
| Finnes i KISS, ikke returnert av M2M-API | `false` | `true` |
| Finnes i begge | `false` | `false` |
| Arkivert i KISS OG returnert av M2M-API | `true` | `false` (reaktivering) |

**API utilgjengelig:** Seed kun fra KISS primærlagring. Varsle brukeren. Inkluder `apiUnavailable: true` i snapshots. Ingen verdier markeres `is_gone`.

### 4. Arkivert + borte = utelatt

Verdier som er arkiverte **og** ikke returneres av M2M-API inkluderes ikke i nye gjennomganger.

### 5. Isolasjonsprinsipp

Under gjennomgangen skrives vurderinger **kun til `staged_data JSONB`**. Primærlagring oppdateres ikke underveis. Én aktiv gjennomgang per aktivitetstype per applikasjon (guard i `findActiveReviewConflict()`).

### 6. Atomisk commit

Alle vurderinger skrives i **én transaksjon** ved fullføring:
1. Idempotenssjekk: `WHERE status = 'pending'` — returner suksess hvis allerede `completed`
2. Upsert aktive rader (`is_gone = false, is_new = false`) → primærlagring
3. Insert ny rad for reaktiverte verdier (`is_new = true`) → primærlagring
4. Soft-delete borte rader (`is_gone = true`) → `archivedAt`/`archivedBy`
5. Lagre `snapshotAfter` med diskriminert union
6. Marker aktivitet som `completed`; review som `needs_follow_up` ved uadresserte oppfølgingspunkter

### 7. Fullføringskriterium

Validering skjer mot `staged_data` alene: alle elementer der `is_gone = false` må ha vurdering satt. Hva som utgjør en vurdering defineres per aktivitetstype.

### 8. `staged_data JSONB` som arbeidsformat

Alle `staged_data`-dokumenter har `activityType` og `schemaVersion` som obligatoriske toppnivå-felt:
```jsonc
{ "activityType": "entra_id_group_maintenance", "schemaVersion": 1, "groups": [] }
```

Patch-operasjoner bruker `withAdvisoryLock()` med låsnavn `<activityType>-activity-<activityId>`. `staged_data` beholdes etter commit — slettes aldri.

---

## Dataflyt — målarkitektur

```
Aktivitetsstart:
  [1] snapshotBefore fra KISS primærlagring (FØR fletting)
  [2] Seed + flett: KISS + M2M-API → staged_data (is_new / is_gone / eksisterende)

Under gjennomgangen:
  → skriv kun til staged_data (advisory lock + transaksjon)
  → én aktiv gjennomgang per aktivitetstype per app

Fullføring (transaksjon):
  [1] Idempotenssjekk
  [2] Upsert aktive rader → primærlagring
  [3] Insert reaktiverte → primærlagring
  [4] Soft-delete borte → primærlagring
  [5] snapshotAfter → routine_review_activities
  [6] activity.status = 'completed'

Rapport: snapshotBefore / snapshotAfter — aldri live data
```

---

## Implementasjonsmatrise

| Aktivitet | Isolasjon | API-fletting | Snapshot | Commit-tx | `staged_data` |
|---|---|---|---|---|---|
| `oracle_role_criticality` *(planlagt)* | ✅ | ✅ | ✅ | ✅ | ✅ |
| `rpa_user_maintenance` | ✅ | Ingen ekstern kilde ¹ | ✅ | ✅ | ✅ |
| `entra_id_group_maintenance` | ✅ | Delvis ² | ✅ | ✅ | ✅ |

¹ RPA har ingen ekstern M2M-kilde. Legitimt designvalg.
² Entra-snapshots mangler `type`/`schemaVersion` (legacy-format).

---

## Sjekkliste for nye vedlikeholdsaktivitetstyper

1. Legg til aktivitetstypen i `ROUTINE_ACTIVITY_TYPES`, label og gruppe i `app/lib/activity-types.ts`
2. Verifiser/opprett primærlagringstabell i `app/db/schema/` med matching-nøkkel som partial unique index (`CREATE UNIQUE INDEX ... WHERE archived_at IS NULL`), vurderingsfelt og audit-kolonner
3. Definer TypeScript-type og runtime-schema (Zod) for `staged_data`-dokumentstruktur med `activityType`, `schemaVersion`, `is_new`, `is_gone` og vurderingsfelt
4. Definer matching-nøkkel som navngitt konstant i seed-funksjonen
5. Implementer seed-funksjon: `snapshotBefore` fra KISS (FØR fletting), hent M2M-API, normaliser + dedupliser, flett, håndter `apiUnavailable`, lagre i `staged_data` (idempotent)
6. Implementer patch-actions — skriv **kun** til `staged_data` via `withAdvisoryLock()`
7. Legg til aktivitetstype-spesifikk action-håndtering (intent-basert routing: save, complete, skip/discard)
8. Implementer commit-funksjon i transaksjon (se prinsipp 6 over)
9. Implementer UI-stegkomponent i gjennomgangs-wizarden
10. Legg til snapshot-parsingstøtte i rapportgeneratoren for ny `snapshot.type`
11. Oppdater `expectedTables` i `migrations.integration.test.ts` med nye tabeller
12. Legg til idempotente migrasjoner i `drizzle/`

---

## Sjekkliste for nye bevisaktivitetstyper

Se `app/lib/evidence-providers/types.ts` for `EvidenceProvider`-interfacet.

0. Legg til ny provider-type i `EvidenceProviderType`-unionen i `app/lib/evidence-providers/types.ts`
1. Implementer `EvidenceProvider`-interfacet (`getStatus`, `downloadFile`)
2. Registrer provideren i `app/lib/evidence-providers/index.server.ts`
3. Legg til UI-config i `app/lib/evidence-providers/ui-config.ts` (ny blokk + case i `getProviderUiConfig()`)
4. Legg til aktivitetstypen i `ROUTINE_ACTIVITY_TYPES` og labelmap i `app/lib/activity-types.ts`
5. Utvid `EvidenceSection`-komponenten (`app/components/evidence/EvidenceSection.tsx`) med ny case
6. Implementer lagring av evidence-metadata i provider-spesifikk tabell + sett `snapshotBefore`/`snapshotAfter`
7. Implementer idempotent fullføring (`WHERE activity.status = 'pending'`)
8. Legg til idempotente migrasjoner for nye provider-spesifikke tabeller
