# De GitHub App-login instellen

Deze test gebruikt GitHub App `kwadendamme-decap-test-xand3rr` (App ID 5252240).
De app moet uitsluitend geïnstalleerd zijn op `xand3rr/drkwdtest`, met Contents:
Read & write, Metadata: Read-only en verlopende gebruikerstokens ingeschakeld.
Webhook Active en wildcard matching staan uit. Redirect URI (in sommige
documentatie Callback URL genoemd):

`https://kwadendamme-decap-login.xanderfaase-cloudflare.workers.dev/callback`

De aangemaakte privésleutel blijft veilig op de eigen computer. Deze worker
gebruikt de App-client-ID en client secret, niet de privésleutel of het App ID
als vervanging voor de client-ID. Dit is eigen logincode, geen door Decap
geleverde server. De echte browserroute moet nog worden getest.

## Cloudflare-code

Open Workers & Pages → kwadendamme-decap-login → Edit code. Vervang de hele
Hello World-code door `auth/worker.mjs` en kies Deploy. De module heeft geen
imports of externe packages. Zolang onderstaande instellingen ontbreken,
meldt de hoofdpagina dat de loginserver nog niet volledig ingesteld is (503).

## Gewone variabelen

Open de Worker → Settings → Variables and Secrets → Add en kies type Text.

| Naam | Waarde |
| --- | --- |
| SITE_ORIGIN | https://drkwdtest.xanderfaase.nl |
| WORKER_ORIGIN | https://kwadendamme-decap-login.xanderfaase-cloudflare.workers.dev |
| GITHUB_REPO | xand3rr/drkwdtest |
| GITHUB_APP_ID | 5252240 |

## Secrets

Ga in GitHub naar Settings → Developer settings → GitHub Apps → deze app.
Kopieer de Client ID. Kies Generate a new client secret en kopieer die waarde
rechtstreeks naar Cloudflare. Kies voor deze drie variabelen het type Secret:

- GITHUB_CLIENT_ID: de Client ID van deze GitHub App, niet het App ID.
- GITHUB_CLIENT_SECRET: de zojuist gegenereerde client secret.
- SESSION_SECRET: lokaal gegenereerde willekeurige sleutel. Met Node:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Bewaar deze waarden uitsluitend in Cloudflare-secrets en een veilige eigen
bewaarplek, nooit in GitHub, screenshots of de chat. Klik Deploy nadat de
variabelen en secrets ingevuld zijn. De hoofdpagina hoort nu te melden:

`Dorpsraad Kwadendamme: loginserver is ingesteld. Start de aanmelding via de beheerpagina van de website.`

Dit bewijst alleen dat de configuratie aanwezig is, niet dat de echte login
al werkt. Open /auth of /callback niet handmatig als login-test: de aanmelding
moet vanuit /admin/ komen voor de veilige popup-handshake.

## Wat de code controleert

De login vraagt geen brede OAuth-scopes. De getekende, kortlevende HttpOnly-
cookie bindt de GitHub state en PKCE-verifier aan de callback. Na tokenuitgifte
controleert de worker het App ID, de installatie-eigenaar, Contents-schrijfrecht,
uitsluitend de gekozen repository en het schrijfrecht van de aangemelde gebruiker.
Een installatie op alle of meer dan één repository wordt geweigerd.

Alleen een GitHub App-gebruikerstoken met maximaal acht uur geldigheid wordt
aan de vaste website-origin gegeven. Refresh tokens worden niet opgeslagen
of doorgegeven. Na verlopen van de token meld je opnieuw aan. De negen
meegeleverde tests simuleren GitHub; echte login/opslaan/commit/publiceren
zijn nog niet als geslaagd aangemerkt. Zie LEESMIJ.md en BEVEILIGING.md.

Bronnen:
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/rest/apps/installations
- https://developers.cloudflare.com/workers/configuration/secrets/
- https://decapcms.org/docs/github-backend/
