const { app } = require('electron');

app.whenReady().then(async () => {
  const { PPOQueryDriver } = await import('../src/query-driver.js');
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const driver = new PPOQueryDriver({ dataDir: '/tmp/ppo-query-smoke' }, logger);
  try {
    await driver.ensureBrowser();
    await driver.navigate('https://www.ppo.gov.eg/ppo/r/ppoportal/ppoportal/traffic', 25_000);
    const events = [];
    await driver.initializeOfficialForm(event => events.push(event), 1);
    const state = await driver.window.webContents.executeJavaScript(`(() => {
      const visible = element => Boolean(element && element.offsetParent !== null && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0);
      const button = document.getElementById('GET_FIN_LETTER_NUMBERS_BTN')
        || [...document.querySelectorAll('[id*="GET_FIN"]')].find(element => visible(element));
      return {
        url: location.href,
        letterVisible: visible(document.getElementById('P14_LETER_1')),
        numberVisible: visible(document.getElementById('P14_NUMBER_WITH_LETTER')),
        buttonFound: Boolean(button),
        buttonVisible: visible(button),
        candidates: [...document.querySelectorAll('[id*="GET_FIN"]')].map(element => ({
          tag: element.tagName,
          id: element.id,
          text: (element.innerText || element.value || '').trim(),
          visible: visible(element),
          parentId: element.parentElement?.id || ''
        }))
      };
    })()`, true);
    process.stdout.write(`${JSON.stringify({ ok: true, state, events })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, message: error.message, code: error.code || null, formState: error.formState || null })}\n`);
    process.exitCode = 1;
  } finally {
    await driver.close();
    app.quit();
  }
});
