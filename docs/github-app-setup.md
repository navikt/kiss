# GitHub App-oppsett for KISS

## Oversikt

KISS bruker en GitHub App for å hente informasjon om hvem (team og personer) som har tilgang til GitHub-repositoriene som tilhører overvåkede applikasjoner. Dataen synkroniseres daglig og vises på applikasjonsdetalj-siden.

## Steg 1: Opprett GitHub App

1. Gå til https://github.com/organizations/navikt/settings/apps/new
2. Fyll inn:
   - **GitHub App name**: `KISS Repo Access Reader` (eller tilsvarende unikt navn)
   - **Homepage URL**: `https://kiss.ansatt.nav.no`
   - **Webhook**: Deaktiver (untick "Active") – vi bruker kun polling
3. Sett tilganger (Permissions):
   - **Repository permissions**:
     - `Administration`: **Read-only** – for å lese collaborators og team-tilganger
   - **Organization permissions**:
     - `Members`: **Read-only** – for å lese team-medlemskap transitivt
4. **Where can this GitHub App be installed?**: "Only on this account" (navikt)
5. Klikk "Create GitHub App"

## Steg 2: Generer Private Key

1. Etter opprettelse, gå til App-innstillingene
2. Under "Private keys", klikk "Generate a private key"
3. En `.pem`-fil lastes ned – denne er din `GITHUB_APP_PRIVATE_KEY`
4. **Oppbevar denne sikkert** – den gir tilgang til alle repos appen er installert på

## Steg 3: Installer appen i navikt-organisasjonen

1. Gå til App-innstillingene → "Install App"
2. Velg `navikt`-organisasjonen
3. Velg "All repositories" (eller spesifiser repos om ønskelig)
4. Klikk "Install"
5. Etter installasjon, noter **Installation ID** fra URL-en:
   `https://github.com/organizations/navikt/settings/installations/<INSTALLATION_ID>`

## Steg 4: Noter App ID

1. Gå til App-innstillingene (https://github.com/organizations/navikt/settings/apps/<app-slug>)
2. Under "About", finn **App ID** (et tall, f.eks. `123456`)

## Steg 5: Konfigurer NAIS-secrets

Legg til følgende secrets i NAIS-applikasjonen:

```yaml
# .nais/prod.yaml og .nais/dev.yaml
spec:
  envFrom:
    - secret: kiss-github-app
```

Opprett secreten med:

```bash
# Opprett secret i NAIS
kubectl create secret generic kiss-github-app \
  --from-literal=GITHUB_APP_ID=<app-id> \
  --from-literal=GITHUB_APP_INSTALLATION_ID=<installation-id> \
  --from-file=GITHUB_APP_PRIVATE_KEY=<path-to-private-key.pem>
```

Eller via NAIS Console / Google Secret Manager avhengig av cluster-oppsett.

## Steg 6: Aktiver synkronisering

Sett environment-variabel for å aktivere GitHub-tilgangssynkronisering:

```yaml
spec:
  env:
    - name: ENABLE_GITHUB_ACCESS_SYNC
      value: "true"
```

## Lokal utvikling

For lokal testing, sett miljøvariablene i `.env` (gitignorert):

```env
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=789012
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
ENABLE_GITHUB_ACCESS_SYNC=true
```

**Merk:** Private key støtter både ekte linjeskift (fra `--from-file` / Kubernetes Secret) og `\n`-escapes (typisk i `.env`-filer). Koden normaliserer automatisk.

## API-endepunkter som brukes

| Endepunkt | Formål |
|-----------|--------|
| `GET /repos/{owner}/{repo}/collaborators` | Hente individuelle collaborators med roller |
| `GET /repos/{owner}/{repo}/teams` | Hente team som har tilgang med roller |
| `GET /orgs/{org}/teams/{team_slug}/members` | Hente team-medlemmer (transitiv) |
| `POST /app/installations/{id}/access_tokens` | Generere installation access token |

## Rate limiting

GitHub API har rate limits på 5000 requests/time for GitHub App installation tokens. Med daglig synkronisering og typisk antall repos (< 200) bør dette ikke være et problem:
- 1 request per repo for collaborators
- 1 request per repo for teams
- 2 requests per team for members (alle medlemmer + maintainers for rolleidentifisering)
- Total: ~200 + 200 + ~100 = ~500 requests per synkroniseringssyklus

## Feilhåndtering

- Hvis GitHub API returnerer 403/404 for et repo, logges det men synkroniseringen fortsetter for andre repos
- Hvis GitHub App ikke er konfigurert (manglende env vars), hoppes synkroniseringen over
- Per-app feil fanges av try/catch — én app som feiler stopper ikke synkronisering av andre
- Installation tokens caches i minnet og refreshes når < 5 minutter gjenstår av levetiden (1 time)

## Sikkerhet

- Private key lagres kun som NAIS-secret, aldri i kode eller git
- Installation tokens er kortlevde (1 time) og gir kun read-tilgang
- Appen har minimale tilganger – kun det som trengs for å lese tilgangsinformasjon
