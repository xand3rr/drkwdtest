(async function () {
  const status = document.getElementById('status');
  const message = document.getElementById('message');
  try {
    const response = await fetch('settings.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('De beheerinstellingen ontbreken. Bouw de basis opnieuw.');
    const settings = await response.json();
    if (!settings.configured) {
      message.textContent = 'De tekstpagina werkt. Voor echte login en opslag moeten jouw GitHub-repository en loginserver nog worden ingesteld. Volg LEESMIJ.md in het pakket.';
      return;
    }
    const configResponse = await fetch('config.yml', { cache: 'no-store' });
    if (!configResponse.ok) throw new Error('De CMS-configuratie ontbreekt.');
    const config = await configResponse.json();
    const allowed = 'https://cdn.jsdelivr.net/npm/decap-cms@3.16.3/dist/decap-cms.js';
    if (settings.script !== allowed || settings.version !== '3.16.3') throw new Error('Onverwachte CMS-versie of scriptbron.');
    window.CMS_MANUAL_INIT = true;
    message.textContent = 'Decap 3.16.3 laden…';
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = allowed;
      const timer = setTimeout(() => { script.remove(); reject(new Error('Decap laden duurt langer dan 15 seconden. Controleer je verbinding en herlaad de beheerpagina.')); }, 15000);
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('Het officiële Decap-script kon niet worden geladen. Controleer netwerktoegang tot cdn.jsdelivr.net.')); };
      document.body.append(script);
    });
    if (!window.CMS?.init) throw new Error('Decap heeft geen CMS-interface beschikbaar gemaakt.');
    window.CMS.init({ config });
    status.remove();
  } catch (error) { message.textContent = error.message || 'Het beheer kon niet worden geopend.'; }
})();
