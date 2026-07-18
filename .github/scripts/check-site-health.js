// Opens the deployed Chess Analyzer and checks that it actually works:
// page loads, no uncaught JS errors, the engine reports ready (not an
// error), and the game-fetch flow doesn't show an unexpected error.
// "No ongoing games found" is a normal, benign state and isn't a failure.
// Writes a plain-text report to health-check-report.txt and exits non-zero
// if a real problem was found, so the workflow step can react to it.
const fs = require('fs');
const { chromium } = require('playwright');

const URL = process.env.SITE_URL || 'https://nevradonatwork.github.io/Chess/';
const WAIT_MS = 15000;
const BENIGN_FETCH_ERRORS = [
  'No ongoing games found for this account.',
];

async function main() {
  const problems = [];
  const consoleErrors = [];
  const pageErrors = [];

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => pageErrors.push(err.message));

  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(WAIT_MS);

    const title = await page.title();
    if (!title.includes('Chess Analyzer')) {
      problems.push(`Unexpected page title: "${title}"`);
    }

    const sfStatus = page.locator('.sf-status').first();
    if (await sfStatus.count() > 0) {
      const sfText = (await sfStatus.innerText()).trim();
      if (sfText.includes('Engine error')) {
        problems.push(`Engine status shows an error: "${sfText}"`);
      }
    } else {
      problems.push('Engine status element not found (page may not have rendered).');
    }

    const fetchError = page.locator('.fetch-error').first();
    if (await fetchError.count() > 0) {
      const text = (await fetchError.innerText()).trim();
      if (!BENIGN_FETCH_ERRORS.includes(text)) {
        problems.push(`Fetch-error box shown: "${text}"`);
      }
    }
  } catch (e) {
    problems.push(`Failed to load or inspect the page: ${e.message}`);
  }

  if (pageErrors.length > 0) {
    problems.push(...pageErrors.map(e => `Uncaught JS error: ${e}`));
  }

  await browser.close();

  const report = [
    `URL: ${URL}`,
    `Checked at: ${new Date().toISOString()}`,
    '',
    problems.length ? 'PROBLEMS FOUND:' : 'No problems detected.',
    ...problems.map(p => `- ${p}`),
    '',
    consoleErrors.length ? 'Console errors during the check (for context, may be benign):' : '',
    ...consoleErrors.map(c => `- ${c}`),
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n');

  fs.writeFileSync('health-check-report.txt', report);
  console.log(report);

  if (problems.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(e => {
  fs.writeFileSync('health-check-report.txt', `Health check script crashed: ${e.stack || e.message}`);
  console.error(e);
  process.exitCode = 1;
});
