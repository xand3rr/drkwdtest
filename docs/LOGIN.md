# De echte GitHub-login instellen

De standaard GitHub-backend van Decap heeft een OAuth-loginserver nodig.
Het pakket bevat daarvoor de bestaande, afzonderlijke `auth/worker.mjs`.
De protocoltests zijn behouden. Dit is maatwerk voor de login, geen officiële
door Decap geleverde server. Een echte koppeling moet nog worden getest.

## Benodigde adressen

Voor een testrepository `jouwnaam/kwadendamme-basis`:

- Website: `https://jouwnaam.github.io/kwadendamme-basis/`.
- Website-origin: `https://jouwnaam.github.io`.
- Loginworker: het werkelijk uitgegeven HTTPS-adres van jouw Cloudflare Worker.
- OAuth-callback: dat workeradres plus `/callback`.

## Instellen zonder lokale CMS-packages

1. Maak een aparte Cloudflare Worker. Gebruik de modulecode uit
   `auth/worker.mjs`. Deze code importeert geen andere bestanden/packages en
   kan via de editor in het Cloudflare-dashboard worden ingesteld.
2. Stel gewone variabelen `SITE_ORIGIN`, `WORKER_ORIGIN`, `GITHUB_REPO` en
   `PRIVATE_REPO` in. De exacte namen en voorbeelden staan in `auth/wrangler.toml`.
   Gebruik voor `PRIVATE_REPO` de tekst `false` en een openbare testrepository.
3. Maak in GitHub onder **Settings → Developer settings → OAuth Apps** een
   OAuth-app. De homepage is het testwebsiteadres; de callback is het exacte
   workeradres met `/callback`.
4. Zet `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` en `SESSION_SECRET` als secrets
   op de Worker. Genereer SESSION_SECRET lokaal met:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

5. Publiceer de worker. Op zijn hoofdadres moet hij melden dat hij is ingesteld.
   Bewaar de client secret en sessiesleutel uitsluitend in de worker-secrets.
6. Configureer de website zoals in `LEESMIJ.md`. Bij een eigen domein stel je
   ook `--site-url` in en verander je `SITE_ORIGIN` naar precies dat HTTPS-origin.

De Cloudflare-editor/menu's kunnen veranderen; volg voor de installatie de
actuele officiële instructies. De worker gebruikt Web Crypto en module exports.
Secrets hoeven nergens aan ChatGPT te worden doorgegeven.

## Rechten en echte controle

Beheerders hebben schrijfrecht op de testrepository nodig. De worker controleert
dat recht vóór het teruggeven van een token aan de vaste website-origin. De
GitHub OAuth-scope `public_repo` is breder dan één repository; beperk de rechten
van het gebruikte testaccount.

De CMS-browsercode heeft met die token toegang tot GitHub. Daarom moet ook de
Decap-browsercode worden beoordeeld; alleen de loginworker testen is onvoldoende.

De zes meegeleverde worker-tests gebruiken gesimuleerde GitHub-responses. De
echte test staat in `LEESMIJ.md`: inloggen, tekst opslaan, commit controleren,
nieuwe Pages-build afwachten en na herladen/nieuwe login dezelfde tekst zien.

Bronnen:
- https://decapcms.org/docs/github-backend/
- https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- https://developers.cloudflare.com/workers/get-started/dashboard/
- https://developers.cloudflare.com/workers/configuration/secrets/
