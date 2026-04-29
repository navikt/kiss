# Designprinsipper: Wizard for innledende spørsmål

## Oversikt

Innledende spørsmål (screening) vises som en wizard – ett spørsmål om gangen – med en vertikal stepper for fremdrift. Når alle spørsmål er besvart, navigerer wizarden til en dedikert avslutningsside.

## Prinsipper

### 1. Én tydelig primærhandling per spørsmål

- Hvert spørsmål har **nøyaktig én** primary-knapp som representerer "gå videre"
- Enkle spørsmål (boolean, single_choice, ruleset): **"Lagre og gå videre"** (primary)
- Komplekse spørsmål (persistence, entra_id_groups, oracle_roles): **"Bekreft og gå videre"** (primary)
- Når allerede besvart: Knappen endres til **"Oppdater"** (secondary)

### 2. "Legg til" er alltid tertiær, over datavisningen, høyrejustert

- Tittel/label venstrejustert, tertiær "Legg til"-knapp høyrejustert, samme linje
- Gjelder: Persistence, Entra ID-grupper
- Åpner dialog for å legge til ny entry

### 3. Primærhandlinger er høyrejustert

- Alle primær- og sekundærknapper (lagre/bekreft/oppdater) plasseres høyrejustert med `justify="end"` på HStack
- Gir konsistent visuell plassering og tydelig handlingspunkt

### 4. Aldri disabled knapper – vis feilmeldinger

Følger [Aksel mønster for skjemavalidering](https://aksel.nav.no/monster-maler/soknadsdialog/monster-for-skjemavalidering):

- Submit-knapper skal **aldri** være `disabled`
- Ved ugyldig innsending: vis `ErrorSummary` med lenker til feilfelt
- Første validering skjer på submit (ikke mens bruker interagerer)
- Etter første forsøk: valider på endring (clear errors når bruker fikser)
- `ErrorSummary` får fokus ved feil (via `ref.focus()`)

### 5. Auto-avansering ved besvarelse

- Når et spørsmål besvares (answer transitions null → non-null), navigerer wizarden automatisk til neste spørsmål
- Ved siste spørsmål: navigerer til avslutningssiden (`?step=complete`)
- Brukeren kan alltid navigere tilbake via "← Forrige" eller stepperen

### 6. Avslutningsside etter siste spørsmål

- Wizarden navigerer til `?step=complete` når alle spørsmål er besvart
- Viser suksess-heading, beskrivelse, "Hva nå?"-veiledning
- ExpansionCard med oppsummering av alle svar og "Endre"-knapper
- Stepperen viser et ekstra "Fullført"-steg nederst

## Spørsmålstyper og interaksjon

| Type | Primærhandling | Legg til | Bekreftelse |
|------|---------------|----------|-------------|
| **boolean** | "Lagre og gå videre" (primary) | – | – |
| **single_choice** | "Lagre og gå videre" (primary) | – | – |
| **ruleset** | "Lagre og gå videre" (primary) | – | – |
| **persistence** | "Bekreft og gå videre" (primary) | Tertiær over tabell → dialog | ErrorSummary ved uklassifiserte entries |
| **entra_id_groups** | "Bekreft og gå videre" (primary) | Tertiær over tabell → søkedialog | ErrorSummary ved uklassifiserte grupper |
| **oracle_roles** | "Bekreft og gå videre" (primary) | Ingen (auto-oppdaget) | ErrorSummary ved uklassifiserte roller |

## Valideringsmønster (kode)

```tsx
const [hasAttempted, setHasAttempted] = useState(false)
const errorSummaryRef = useRef<HTMLDivElement>(null)

function handleSubmit(e: FormEvent<HTMLFormElement>) {
  if (!valid) {
    e.preventDefault()
    setHasAttempted(true)
    setTimeout(() => errorSummaryRef.current?.focus(), 0)
  }
}

// Etter første forsøk, clear errors når bruker fikser:
onChange={(val) => { if (hasAttempted && val) setHasAttempted(false) }}
```

## Navigasjon

- **Stepper (venstre sidebar)**: Viser alle spørsmål + "Fullført"-steg. Besvarte spørsmål er klikkbare.
- **"← Forrige"**: Sekundærknapp under spørsmålet for å gå tilbake
- **"Hopp over"**: Tertiær xsmall-knapp under kortet (kun for ubesvarte spørsmål som ikke er siste)
- **URL-state**: `?step=questionId` eller `?step=complete`
