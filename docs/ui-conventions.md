# UI-konvensjoner — KISS

> Les denne filen når du skal lage nye komponenter, sider eller layouts — spesielt for responsivt design og universell utforming.

## Responsivt design

### Breakpoints

| Breakpoint | Bredde | Bruksområde |
|---|---|---|
| `xs` | 0px | Mobil (default) |
| `sm` | 640px | Stor mobil |
| `md` | 768px | Nettbrett |
| `lg` | 1024px | Desktop |
| `xl` | 1280px | Bred skjerm |

### CSS-tokens (Aksel v8)

Aksel v8 bruker `--ax-*` tokens (IKKE `--a-*`):
- Spacing: `--ax-space-4`, `--ax-space-8`, `--ax-space-12`, `--ax-space-16`, `--ax-space-24`
- Farger: `--ax-bg-brand-blue-strong`, `--ax-text-default`, `--ax-border-subtle`
- Radius: `--ax-radius-4`, `--ax-radius-8`
- Font: `--ax-font-size-small`, `--ax-font-size-medium`, `--ax-font-size-heading-xlarge`

### Retningslinjer

1. **Mobile-first** — Design for mobil først, utvid for større skjermer
2. **Aksel HGrid for grid** — `columns={{ xs: 1, sm: 2, md: 4 }}` for responsive grids
3. **Tabeller** — Wrap alle `<Table>` i `<section className="table-scroll" tabIndex={0} aria-label="...">` for horisontal scroll på mobil. Bruk `tabIndex={0}` (ikke `-1`) slik at tastaturbrukere kan navigere scrollbart innhold
4. **Aldri hardkodede bredder** — Bruk `width: 100%; max-width: 80rem; margin: 0 auto;`
5. **Test på 3 breakpoints** — 375px (mobil), 768px (nettbrett), 1280px (desktop)
6. **Aksel VStack** — Bruk for alle vertikale layouts (automatisk responsiv)

---

## Universell utforming (UU / WCAG 2.1 AA)

### Kontrastregler

- **Aldri** bruk `--ax-text-brand-blue-contrast` (hvit) på lyse bakgrunner som `--ax-bg-brand-blue-moderate`
- Hvit tekst krever mørk bakgrunn: bruk `--ax-bg-brand-blue-strong` eller mørkere
- Beregn alltid kontrastforhold ved nye fargekombinasjoner (WebAIM Contrast Checker)
- Nav-baren bruker `--ax-bg-brand-blue-strong` (#457c9d) med hvit tekst = 4.54:1 ✓

### Sjekkliste for nye komponenter

1. Fargekontrast ≥ 4.5:1 (normal tekst) / ≥ 3:1 (stor tekst / UI-elementer)
2. Interaktive elementer nåbare via tastatur
3. Meningsfulle `aria-label` på navigasjon, regioner og skjemaer
4. Skip-link til hovedinnhold (allerede i `root.tsx`)

### Automatisert testing

Playwright-tester i `e2e/accessibility.spec.ts` kjører axe-core mot en definert liste med sider og sjekker WCAG 2.1 AA (wcag2a/wcag2aa/wcag21aa-tagger).

```bash
pnpm test:e2e              # Playwright responsive tester + UU
pnpm test:e2e:ui           # Playwright med UI
pnpm storybook             # Storybook med viewport-presets
```
