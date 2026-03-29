# KISS – Kontrollrammeverk for Integrert Sikker Systemutvikling

Internkontroll-applikasjon for å vise at Nav har kontroll på Software Development Life Cycle (SDLC).

## Hva gjør KISS?

- **Kontrollrammeverk**: Importerer og viser risikoer, kontroller og tiltak fra Navs kontrollrammeverk
- **Compliance-vurdering**: Lar ansvarlige per applikasjon svare ut om den er i overensstemmelse med retningslinjene
- **Nais-overvåking**: Automatisk oppdagelse av nye applikasjoner på Nais-plattformen
- **Rapporter**: Genererer compliance-rapporter per seksjon og på tvers av seksjoner
- **Dashboard**: Overordnet status for SDLC compliance

## Teknologistack

| Komponent | Valg |
|-----------|------|
| Runtime | Node.js 22 LTS |
| Framework | React Router 7 (Framework Mode, SSR) |
| UI | React 19, Aksel designsystem |
| Språk | TypeScript |
| ORM | Drizzle ORM |
| Database | PostgreSQL 17 (CloudSQL) |
| Objektlagring | GCS Buckets |
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
- Docker (for integrasjonstester med Testcontainers)

### Kom i gang

```bash
pnpm install
pnpm dev
```

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
```

## Integrasjoner

- **[Nav Deployment Audit](https://github.com/navikt/deployment-audit)**: Konsoliderte rapporter (planlagt)
- **Nais GraphQL API**: Automatisk oppdagelse av applikasjoner
- **Azure AD**: Autentisering og autorisasjon

## Lisens

Privat – Nav
