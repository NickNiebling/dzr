import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// Reuse the existing architecture tooling; no extra application dependency.
const require = createRequire(new URL('./architecture/package.json', import.meta.url))
const { chromium } = require('playwright-core')
const baseUrl = new URL(process.env.STREAMING_TEST_SITE_URL || 'http://127.0.0.1:3000')
assert.ok(['localhost', '127.0.0.1'].includes(baseUrl.hostname), 'Use an isolated local website with demo Firebase configuration')
const script = await readFile(new URL('../apps/bot/assets/dzr-stream.lua', import.meta.url))
const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || chromium.executablePath(),
  args: ['--no-sandbox'],
})

try {
  for (const { platform, os, supportsPicker } of [
    { platform: 'Win32', os: 'Windows', supportsPicker: true },
    { platform: 'Win32', os: 'Windows', supportsPicker: false },
    { platform: 'MacIntel', os: 'macOS', supportsPicker: true },
    { platform: 'MacIntel', os: 'macOS', supportsPicker: false },
  ]) {
    const context = await browser.newContext({ acceptDownloads: true })
    let downloadFails = false
    await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl.origin ? route.continue() : route.abort())
    await context.route('**/api/auth/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await context.route('**/api/streaming/script', route => route.fulfill({ status: downloadFails ? 503 : 200, contentType: 'text/plain', body: downloadFails ? 'Unavailable' : script }))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(({ platform, supportsPicker }) => {
      Object.defineProperty(navigator, 'platform', { value: platform })
      if (!supportsPicker) {
        window.showSaveFilePicker = undefined
        return
      }
      const state = { error: null, written: null, closed: false, options: null, active: false }
      window.streamingTest = state
      window.showSaveFilePicker = async function (options) {
        if (this !== window) throw new Error('Save picker must be called on window')
        state.options = options
        state.active = navigator.userActivation.isActive
        if (state.error) throw new DOMException('Picker stopped', state.error)
        return {
          name: 'custom$&.lua',
          createWritable: async () => ({
            write: async data => { state.written = Array.from(new Uint8Array(data)) },
            close: async () => { state.closed = true },
          }),
        }
      }
    }, { platform, supportsPicker })
    await page.goto(new URL('/streaming/setup', baseUrl).href, { waitUntil: 'networkidle', timeout: 180_000 })
    // OS detection runs after hydration; do not click the inert server HTML.
    const selectedOs = page.getByRole('button', { name: os, exact: true })
    await selectedOs.and(page.locator('[aria-pressed="true"]')).waitFor()
    await page.getByRole('button', { name: 'Fortsæt', exact: true }).click()
    const next = page.getByRole('button', { name: 'Filen er klar – fortsæt', exact: true })
    const checkbox = page.getByRole('checkbox')
    const transfer = page.getByRole('button', { name: supportsPicker ? 'Gem DZR-script' : 'Download DZR-script', exact: true })
    const otherTransfer = page.getByRole('button', { name: supportsPicker ? 'Download DZR-script' : 'Gem DZR-script', exact: true })
    assert.equal(await transfer.isVisible(), true)
    assert.equal(await otherTransfer.count(), 0)
    assert.equal(await page.getByText('Gem filen et sted, hvor du ikke kommer til at slette den, fx Dokumenter/DZR.', { exact: true }).isVisible(), true)
    assert.equal(await page.getByText(/flyt den fra Downloads/).count(), supportsPicker ? 0 : 1)
    assert.equal(await next.count(), 0)
    assert.equal(await checkbox.count(), 0)

    if (supportsPicker) {
      for (const pickerError of ['AbortError', 'NotAllowedError']) {
        await page.evaluate(error => { window.streamingTest.error = error }, pickerError)
        await transfer.click()
        await page.getByText(pickerError === 'AbortError' ? /Gem som blev annulleret/ : /Browseren fik ikke lov/).waitFor()
        assert.equal(await next.count(), 0)
      }
      await page.evaluate(() => { window.streamingTest.error = null })
    }

    downloadFails = true
    await transfer.click()
    await page.getByText('Filen kunne ikke hentes fra DZR. Prøv igen om lidt.', { exact: true }).waitFor()
    assert.equal(await next.count(), 0)
    assert.equal(await checkbox.count(), 0)
    downloadFails = false

    if (supportsPicker) {
      await transfer.click()
      await page.getByText('custom$&.lua er gemt').waitFor()
      const { options, active, written, closed } = await page.evaluate(() => window.streamingTest)
      assert.deepEqual(options, {
        suggestedName: 'dzr-stream.lua',
        startIn: 'documents',
        types: [{ description: 'Lua-script', accept: { 'text/plain': ['.lua'] } }],
        excludeAcceptAllOption: true,
      })
      assert.equal(active, true)
      assert.deepEqual(Buffer.from(written), script)
      assert.equal(closed, true)
      assert.equal(await checkbox.count(), 0)
    } else {
      const [file] = await Promise.all([page.waitForEvent('download'), transfer.click()])
      assert.equal(file.suggestedFilename(), 'dzr-stream.lua')
      assert.deepEqual(await readFile(await file.path()), script)
      await next.waitFor()
      assert.equal(await next.isDisabled(), true)
      await page.getByText('Jeg har flyttet dzr-stream.lua til en fast placering.', { exact: true }).click()
      assert.equal(await checkbox.isChecked(), true)
    }
    assert.equal(await next.isEnabled(), true)
    await next.click()
    await page.getByRole('heading', { name: 'Åbn Scripts i OBS', exact: true }).waitFor()
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Fortsæt', exact: true }).click()
    const filename = supportsPicker ? 'custom$&.lua' : 'dzr-stream.lua'
    assert.equal(await page.getByText(`Åbn den mappe, hvor du lagde filen i trin 2. Vælg ${filename}, og klik Åbn / Open.`, { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('img', { name: `${os}: Eksempel på filvalg i OBS fra Dokumenter/DZR.`, exact: true }).isVisible(), true)
    await page.getByRole('button', { name: 'Fortsæt', exact: true }).click()
    await page.getByRole('heading', { name: 'Forbind OBS med DZR', exact: true }).waitFor()
    assert.equal(await page.getByText(`Vælg ${filename} i OBS-listen. Indsæt din personlige API-nøgle i DZR key til højre.`, { exact: true }).isVisible(), true)
    assert.equal(await page.getByRole('button', { name: 'Kopiér adresse', exact: true }).count(), 0)
    assert.ok(!(await page.locator('main').innerText()).includes('DZR endpoint'))
    assert.ok(!(await page.locator('main').innerText()).includes('/streaming_add_new'))
    assert.ok(!(await page.locator('main').innerText()).includes('streaming-test.invalid'))
    assert.match(await page.locator('main').innerText(), /én eller flere platforme/)
    await page.getByRole('button', { name: 'Jeg har udfyldt OBS', exact: true }).click()
    await page.getByRole('button', { name: 'Vis forbindelsestest – valgfrit', exact: true }).click()
    assert.ok(!(await page.locator('main').innerText()).includes('/streaming_add_new'))
    assert.ok(!(await page.locator('main').innerText()).includes('DZR endpoint'))
    assert.deepEqual(errors, [])
    console.log(`PASS ${os} guide: ${supportsPicker ? 'Save As' : 'download and manual placement'}`)
    await context.close()
  }

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  })
  await mobile.route('**/*', route => new URL(route.request().url()).origin === baseUrl.origin ? route.continue() : route.abort())
  await mobile.route('**/api/auth/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  const page = await mobile.newPage()
  await page.goto(new URL('/streaming/setup', baseUrl).href, { waitUntil: 'networkidle', timeout: 180_000 })
  const warning = page.getByRole('heading', { name: 'Fortsæt på computeren med OBS', exact: true })
  await warning.waitFor()
  assert.match(await warning.locator('..').innerText(), /mobil/)
  assert.match(await warning.locator('..').innerText(), /OBS.*installeret/)
  assert.equal(await page.getByRole('button', { name: 'Kopiér guideadresse', exact: true }).isVisible(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile guide must fit the viewport')
  await page.getByRole('button', { name: 'Vis guiden alligevel', exact: true }).click()
  assert.equal(await warning.count(), 0)
  await mobile.close()
  console.log('PASS mobile warning, computer explanation, copy/dismiss controls and viewport')
} finally {
  await browser.close()
}
