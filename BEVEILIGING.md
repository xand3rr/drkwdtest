# Beveiligingsstatus — nog niet vrijgegeven

Een officiële of nieuwste release is geen veiligheidsbewijs. Deze basis is
een afzonderlijke, minimale opzet om de werkelijke CMS-route te testen vóór
het toevoegen van vormgeving. Alleen de hieronder benoemde controles zijn
uitgevoerd; zie ook `VALIDATIE.txt`.

## Werkelijk uit de opzet gehaald

De website bouwt met Node zonder externe npm-packages. Er is geen lokale
CMS-proxy. De aangetroffen kritieke keten `decap-server → simple-git →
@simple-git/argv-parser` wordt hier dus niet geïnstalleerd of gestart.
Ook @hapi/joi, Eleventy en de door die lokale toolketen gebruikte watchers
zijn geen dependencies van dit project.

Dit repareert die packages niet; deze opzet gebruikt ze niet.

## Resterende Decap-beoordeling

Decap 3.16.3 wordt in de browser geladen van de versiegebonden officiële CDN-
installatie-URL. Die voorgebouwde browsercode is niet lokaal herbouwd/geaudit.
De eerdere npm-meldingen over onder meer Plate, trim, uuid en sprintf-js mogen
niet als opgelost worden aangemerkt door de distributiemethode te veranderen.
Ook de React/Slate-conflicten zijn geen lokaal aangetoonde reparatie.

Deze basistest configureert alleen `string` en `text` en zet de CMS-preview uit.
Markdown/richtext-deserialisatie is geen aangeboden editorfunctie. Dat verkleint
de scope van de test, maar bewijst zonder beoordeling van de bundle niet dat
alle kwetsbare codepaden onbereikbaar zijn.

Er is een vaste CMS-versie, maar geen onafhankelijk geverifieerde SRI-hash
voor het script toegevoegd. De levering vertrouwt op HTTPS en de CDN. Een
eigen geverifieerde kopie of gecontroleerde herbouw blijft een keuze vóór livegang.

## Login en gegevens

- De OAuth-worker bevat geen pakketafhankelijkheden en gebruikt een vaste
  HTTPS-origin en repository, getekende cookie, state en PKCE.
- De tests simuleren GitHub; echte login/popups/opslag zijn nog niet getest.
- `public_repo` is een brede GitHub-accountscope, niet beperkt tot één repository.
  Gebruik voor deze basistest een account met alleen de benodigde testrechten.
- Geheimen worden alleen als secrets op de loginserver ingesteld, nooit in Git.
- GitHub Pages en de openbare testrepository zijn publiek. `noindex` is geen
  toegangsbeveiliging. Gebruik geen persoonsgegevens of vertrouwelijke inhoud.

## Voorwaarde vóór het dorpsontwerp

Echte login, opslaan, commit, rebuild en herladen moeten slagen. Daarnaast
moet de beveiligingsbeoordeling van de CMS-browsercode zijn afgerond. Dit
pakket declareert die twee voorwaarden niet als geslaagd. Als Decap daarvoor
geen aanvaardbare basis biedt, kiezen we eerst een andere CMS-basis.

Bronnen:
- https://github.com/advisories/GHSA-v5rq-49vh-5v5c
- https://decapcms.org/docs/install-decap-cms/
- https://decapcms.org/docs/github-backend/
