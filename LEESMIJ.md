# Kwadendamme — minimale Decap-validatiebasis

Eén gewone tekstpagina, Decap 3.16.3 en een aparte GitHub App-loginworker.
Nog geen dorpsontwerp. Dit is een testopzet; de volledige CMS-browsercode en
echte login/opslaan/publiceren zijn nog niet als veilig en werkend vrijgegeven.
Zie BEVEILIGING.md en VALIDATIE.txt.

## De afgesproken testomgeving

- Repository: `xand3rr/drkwdtest`, branch `main`.
- Website: `https://drkwdtest.xanderfaase.nl/`.
- Beheer: `https://drkwdtest.xanderfaase.nl/admin/`.
- Loginworker: `https://kwadendamme-decap-login.xanderfaase-cloudflare.workers.dev`.
- GitHub App ID: `5252240`, uitsluitend geïnstalleerd op `drkwdtest`.

De gebruiker heeft DNS/HTTPS en de afzonderlijke Worker ingesteld. De
hoofdresponse van de Worker bevestigt alleen aanwezige configuratie. De
volledige CMS-login moet nog vanuit de beheerpagina worden getest.

## Publiceren op uitsluitend de testrepository

De workflow `.github/workflows/pages.yml` heet **Test and publish Decap baseline**.
Hij start bij een commit op `main` en draait uitsluitend in `xand3rr/drkwdtest`.
Eerst `npm test`, daarna `npm run build`, upload van alleen `_site` en een
afzonderlijke Pages-publicatiejob. Alleen die laatste job krijgt Pages- en
OIDC-schrijfpermissies; Git-inhoud wordt door deze workflow niet teruggeschreven.
Acties zijn vastgezet op geverifieerde releasecommits.

1. Upload de INHOUD van de projectmap naar de root van `xand3rr/drkwdtest`,
   inclusief `.github/workflows/pages.yml`. Upload `_site` niet.
2. Bij de aparte testrepo: Settings → Pages → Source = GitHub Actions. Het
   aangepaste domein en HTTPS zijn daar al ingesteld.
3. Commit naar `main`. Open Actions → Test and publish Decap baseline.
4. Zowel validate als deploy moeten slagen. Open daarna de beheer-URL.

Het kleine updatepakket bevat alleen gewijzigde configuratie, loginbron/tests,
workflow en documentatie. Het bevat geen `content/page.json` en overschrijft
daardoor geen later ingevoerde pagina-inhoud. In deze bronnen staan geen
client secrets, sessiesleutels of privésleutels. Die horen in Cloudflare.
De bestaande website-repository `xand3rr.github.io` is buiten deze opzet.

## De echte CMS-test

1. Open de beheerpagina en meld aan met GitHub.
2. Open **Pagina's → Testpagina** en verander de tekst in een herkenbare testzin.
3. Publiceer in Decap.
4. Controleer de nieuwe commit met `content/page.json` op `main`.
5. Wacht tot de bijbehorende validate- en deploy-jobs groen zijn.
6. Herlaad de bezoekerspagina en controleer de testzin.
7. Meld af, meld opnieuw aan en controleer dezelfde opgeslagen tekst.
8. Controleer dat een account zonder schrijfrecht geen toegang krijgt.

Na maximaal acht uur verloopt de GitHub App-gebruikerstoken: meld dan opnieuw
aan. De Worker geeft geen refresh token aan de CMS-browser.
Pas na deze tests en de resterende beoordeling van de Decap-browsercode
zetten we het eerder gemaakte dorpsontwerp erin.

## Lokaal bekijken

Installeer Node 22 of nieuwer. Open een terminal in deze projectmap:

```sh
npm run preview
```

Open http://localhost:8080/. Er is geen npm-installatie nodig: de lokale
bouwketen heeft geen externe packages. Inhoud staat in `content/page.json`.
Voor een handmatige wijziging: bewerk dat bestand en voer `npm run build` uit.
De echte login is gebonden aan het HTTPS-testdomein, niet aan localhost.

## Beveiligingsgrenzen

HTML-invoer wordt als gewone tekst weergegeven. Er is geen richtextwidget,
Markdown-editor, CMS-preview of lokale Git-proxy geïnstalleerd.
De vaste Decap-browserbundle wordt extern via HTTPS geladen; dat is geen
herbouw of bewijs dat eerdere npm-advisories opgelost zijn.
De Worker gebruikt state, PKCE, getekende HttpOnly-cookie, vaste origins en
controles op de exacte App, installatie, repository en schrijfrechten.
De 13 lokale tests gebruiken voor GitHub gesimuleerde antwoorden.

Bronnen:
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://decapcms.org/docs/github-backend/
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
