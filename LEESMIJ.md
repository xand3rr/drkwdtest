# Kwadendamme — minimale Decap-validatiebasis

Deze afzonderlijke basis bevat één tekstpagina en Decap 3.16.3 via de officiële
CDN-installatiemethode. Er is nog geen dorpsontwerp toegevoegd. De bestaande
websitebestanden zijn behouden in het eerdere pakket.

**Status: voorbereid voor validatie, niet als veilig/werkend CMS vrijgegeven.**
De bezoekerspagina en OAuth-protocoltests kunnen lokaal worden gecontroleerd.
Een echte GitHub-login, CMS-opslag en de beveiligingsbeoordeling van de
Decap-browsercode zijn nog niet geslaagd. Zie `BEVEILIGING.md`.

## Direct bekijken

Pak deze ZIP uit in een NIEUWE map, naast je bestaande project. Installeer Node.js
22 of nieuwer. Open een terminal in `kwadendamme-basis`:

```sh
npm run preview
```

Open http://localhost:8080/. Je hoeft **geen npm install** uit te voeren.
De bron voor deze ene pagina staat in `content/page.json`. Handmatig aanpassen
en daarna `npm run build` uitvoeren werkt ook zonder externe packages.

`/admin/` toont voorlopig setupinformatie. Er is geen nep-login en geen
browseropslag die als echte CMS-opslag wordt voorgesteld.

## Werkelijke CMS-test instellen

**Huidige fase:** de domeinkoppeling is uitgesteld. De workflow in dit pakket
bouwt en test alleen. Hij maakt een downloadbaar artifact `minimal-cms-base`
en publiceert geen website. Er zijn geen Pages-schrijf- of deployrechten.
Repository en toekomstig websiteadres staan ingesteld op `xand3rr/drkwdtest`
en `https://drkwdtest.xanderfaase.nl/`; de loginserver is nog niet ingesteld.
Upload uitsluitend naar die nieuwe repository. De bestaande website-repository
`xand3rr.github.io` wordt niet gebruikt.

Voor deze eerste GitHub-build kun je de basis direct uploaden zonder een
loginserver in te stellen. Stap 3 en het configure-commando voor authUrl hieronder
horen bij de latere online CMS-test. Gebruik daarvoor repository
`xand3rr/drkwdtest` en siteUrl `https://drkwdtest.xanderfaase.nl/`.

1. Maak een aparte openbare GitHub-testrepository met branch `main`. Begin met
   een README zodat die branch bestaat. Gebruik uitsluitend testinhoud.
2. Kies **Settings → Pages → Source → GitHub Actions** in die repository.
3. Maak de loginserver en GitHub OAuth-app volgens `docs/LOGIN.md`.
4. Stel jouw repository en loginserver in:

```sh
npm run configure -- --repository jouwnaam/kwadendamme-basis --auth-url https://jouw-loginserver.workers.dev
npm run build
npm test
```

5. Upload de INHOUD van deze projectmap naar de repositoryroot, inclusief
   `.github/workflows/pages.yml`. `_site` hoeft niet mee. Er zijn geen secrets
   in deze projectmap; die horen op de loginserver.
6. Open **Actions → Build and test minimal CMS base**. De tests en build moeten
   groen worden. Onder **Artifacts** vind je de gebouwde `minimal-cms-base`.
   Voor echte online login moeten we later het subdomein en de loginserver
   instellen en publicatie toevoegen; deze workflow doet dat nog niet.

De loginserver accepteert uitsluitend de ingestelde HTTPS-website. Een echte
GitHub-login vanaf `localhost` hoort daarom niet bij deze test. Er is bewust
geen lokale Decap-proxy toegevoegd.

## De test die we vóór het ontwerp willen zien slagen

Deze volledige test kan pas na het later instellen van hosting en login.

1. Open `/admin/` en log werkelijk in met GitHub.
2. Open de **Testpagina** en verander de tekst in een herkenbare testzin.
3. Kies publiceren/opslaan in Decap.
4. Controleer dat `content/page.json` op `main` de wijziging bevat.
5. Wacht tot GitHub Actions de nieuwe versie heeft gepubliceerd.
6. Herlaad de bezoekerspagina en controleer de testzin.
7. Meld af, meld opnieuw aan en controleer dat de tekst bewaard is.
8. Controleer dat een account zonder schrijfrecht geen toegang krijgt.

Pas na die controles én de beoordeling in `BEVEILIGING.md` kan de basis
worden vrijgegeven en zetten we het eerder gemaakte dorpsontwerp erin.

## Wat deze opzet anders doet

- Geen Eleventy-installatie of watcher; één kleine Node-builder verwerkt JSON.
- Geen decap-server, simple-git of @hapi/joi in de website/toolketen.
- Alleen titel en gewone tekst; geen Markdown/richtext-editor of CMS-preview.
- Decap-browsercode wordt geladen van de vaste HTTPS-URL voor versie 3.16.3.
  Dat volgt de officiële installatievorm. Het verandert de Decap-code niet.
- Inhoud wordt als tekst geescaped in HTML; ingevoerde HTML wordt niet uitgevoerd.
- De loginworker gebruikt vaste origins/repository, state, PKCE en ondertekende
  cookies. De echte GitHub/Cloudflare-koppeling moet nog worden beproefd.

Geen npm-afhankelijkheden betekent alleen dat deze lokale bouwketen geen npm-
dependencyboom heeft. Het is geen bewijs dat de extern geladen CMS-code veilig is.

## Officiële documentatie

- https://decapcms.org/docs/install-decap-cms/
- https://decapcms.org/docs/github-backend/
- https://decapcms.org/docs/manual-initialization/
- https://decapcms.org/docs/widgets/text/
