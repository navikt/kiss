# Ruting — KISS

> Les denne filen når du skal legge til en ny rute i applikasjonen.

## Sjekkliste for nye ruter

1. **Legg til ruten i `app/routes.ts` FØRST** — uten ruteregistrering vil URL-en gi 404
2. **Verifiser at alle lenker peker til registrerte ruter** — sjekk at `to`-proppen i `<Link>` og `<Button as={Link}>` matcher et mønster i `routes.ts`
3. **Test at ruten svarer med HTTP 200** før commit — `curl -s -o /dev/null -w '%{http_code}' <url>`
4. **Sjekk at lenker fra eksisterende sider fungerer** — navigasjonsflyt skal testes ende-til-ende
5. **Alle `redirect()`-kall skal bruke absolutte stier** — relative stier som `../rutiner/` kan resolveres feil. Bruk alltid absolutte stier, f.eks. `/seksjoner/${seksjon}/rutiner/${id}`
6. **Relative lenker (`to="./..."` og `to="../..."`) skal resolves mot rutens eget mønster** — f.eks. `./ny-gjennomgang` fra `seksjoner/:seksjon/rutiner/:rutineId` resolves til `.../rutineId/ny-gjennomgang`, som må matche en registrert rute
7. **`href`-attributter som peker til interne API-ruter** (f.eks. `href="/api/rutine-vedlegg/${id}"`) skal valideres mot registrerte ruter
8. **Automatiserte tester SKAL opprettes** for å verifisere:
   - At alle ruter i `routes.ts` har en tilhørende rutefil
   - At alle `redirect()`-kall i action-funksjoner peker til ruter som finnes i `routes.ts`
   - At alle `<Link to="...">` og `href="..."`-attributter peker til gyldige ruter
   - At alle relative lenker resolves korrekt

## Filstruktur

Hver rute har sin egen mappe. Rutefilen heter `index.tsx`:
```
app/routes/
├── _index/index.tsx
├── kontrollrammeverk/index.tsx
├── kontrollrammeverk.$domene/index.tsx
└── ...
```

## Server-only imports i rutefiler

React Router 7 fjerner `.server`-imports kun fra `loader`/`action`/`middleware`/`headers`. Funksjoner som brukes i JSX-komponenter **kan ikke** importeres fra `.server.ts`-filer. Bruk `app/lib/utils.ts` for delte utility-funksjoner som trengs på klienten.
