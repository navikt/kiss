# Tilgangskontroll — KISS

> Les denne filen når du skal forstå roller, scope (global/seksjon/team), Entra ID-teamkobling, eller autorisasjonslaget i `app/lib/authorization.server.ts` og `app/lib/auth.server.ts`.

## Prinsipp

Innlogging er åpen for alle Entra ID-brukere med gyldig token (ingen allowlist i `getAuthenticatedUser()`). Team- og applikasjonsinformasjon er derimot låst ned til de teamene som forvalter dem — tilgang gis eksplisitt via roller.

## Roller (`userRoleEnum` i `app/db/schema/organization.ts`)

| Rolle | Scope | Norsk navn |
|---|---|---|
| `admin` | global | Admin |
| `auditor` | global | Revisor |
| `section_manager` | seksjon | Seksjonsleder |
| `tech_manager` | seksjon | Teknologileder |
| `delivery_manager` | seksjon | Leveranseleder |
| `system_owner` | seksjon | Systemeier |
| `product_owner` | team | Produktleder |
| `tech_lead` | team | Tech Lead |
| `developer` | team | Utvikler (Teammedlem) |

`ELEVATED_TEAM_ROLES` (`product_owner`, `tech_lead`) er team-roller som kan tildeles manuelt selv for Entra-koblede team, jf. under.

## To måter å gi tilgang til et team

1. **Manuell tildeling** — rader i `user_roles` (`assignRole()` i `app/db/queries/users.server.ts`), forvaltes fra team-rediger-siden.
2. **Entra ID-gruppekobling** — et team kobles til én Entra ID-gruppe (`dev_teams.entra_group_id`). Alle aktive medlemmer av gruppen får automatisk "Teammedlem"-tilgang (`developer`-nivå), uten en rad i `user_roles`. Synkroniseres periodisk av `entra-team-sync.server.ts` inn i `dev_team_entra_members`-tabellen (se `app/db/queries/dev-team-entra.server.ts`).

For Entra-koblede team er `developer`-tilgang alltid styrt av gruppemedlemskap — den kan ikke tildeles manuelt. `product_owner`/`tech_lead` kan derimot tildeles manuelt, men **kun til navIdent-er som er aktive medlemmer av den koblede Entra-gruppen** (håndhevet i query-laget, jf. #707).

### Henge-igjen-roller

Hvis noen mister medlemskap i en koblet Entra-gruppe, tilbakekalles eventuelle `product_owner`/`tech_lead`-roller automatisk (`revokeElevatedRolesForDepartedMembers()` i `dev-team-entra.server.ts`) — men **kun** når endringen kommer fra en verifisert medlemskapssynk eller en admin-initiert re-kobling. Hvis Entra-gruppen selv slettes (Graph 404), antas det å kunne være en admin-feil, og roller rører **ikke** — de kan gjenopprettes trygt ved å koble til gruppen på nytt (evt. med nytt Object ID).

## Effektiv autorisasjon (`getAuthenticatedUser()` → `NavUser`)

Per request beregnes:
- `dbRoles: UserRoleEntry[]` — manuelt tildelte roller, inkl. `devTeamSectionId` for team-roller (hvilken seksjon teamet tilhører).
- `entraTeamIds: string[]` — team-ID-er brukeren er automatisk medlem av via Entra-gruppe.
- `entraSectionIds: string[]` — seksjons-ID-ene til de samme teamene (for at Entra-medlemmer skal få samme seksjonstilgang som manuelle team-medlemmer, se under).

Ved auditor-suppression (bruker har `auditor`-rolle men er ikke admin) strippes `dbRoles` til kun `auditor`, og `entraTeamIds`/`entraSectionIds` strippes til `[]` — revisorer skal aldri få team-/seksjonstilgang via automatisk medlemskap.

## Sjekkfunksjoner (`app/lib/authorization.server.ts`)

- `hasAnyTeamRole(user, devTeamId)` — true for admin, aktivt Entra-medlemskap (`entraTeamIds`), eller en team-scopet `dbRole` for teamet.
- `hasAnySectionRole(user, sectionId)` — true for admin, direkte seksjonsrolle, team-rolle der teamet tilhører seksjonen (`devTeamSectionId`), **eller** Entra-teammedlemskap i et team som tilhører seksjonen (`entraSectionIds`). Gir kun skriverettigheter (godkjenne rutine, opprette regelsett, redigere screening) — lesetilgang til seksjonens rutiner/regelsett/screening er allerede åpen for alle innloggede brukere uavhengig av rolle.
- `canManageTeam(user, devTeamId, sectionId?)` — kun `product_owner`/`tech_lead` for teamet, eller `tech_manager`/`section_manager` for seksjonen. Automatisk Entra-medlemskap gir **aldri** manage-rettigheter, kun `hasAnyTeamRole`.
- `canManageSection(user, sectionId)` — kun `section_manager`/`tech_manager` for seksjonen.

## Ikke gjør

- Ikke legg til en allowlist/whitelist for innlogging — målet er åpen tilgang for alle Entra-brukere.
- Ikke la automatisk Entra-medlemskap gi `canManageTeam`/`canManageSection` — kun `hasAnyTeamRole`/`hasAnySectionRole`.
- Ikke tilbakekall elevated-roller (`product_owner`/`tech_lead`) ved Entra-gruppe*sletting* — kun ved verifisert medlemskapsendring eller admin-initiert re-kobling (se «Henge-igjen-roller» over).
