const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.baidu.com', { waitUntil: 'domcontentloaded' });
  console.log('title:', await page.title());
  console.log('url:', page.url());
  await page.screenshot({ path: 'scripts/baidu.png', fullPage: false });
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });
