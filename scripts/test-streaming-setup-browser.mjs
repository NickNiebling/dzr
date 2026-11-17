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

async function assertButtonContrast(button, state) {
  const { text, focus } = await button.evaluate(async element => {
    const style = getComputedStyle(element)
    // Settle Chakra's color transition before reading the final state.
    void style.backgroundColor
    await Promise.all(element.getAnimations().map(animation => animation.finished))

    const rgba = value => value.match(/[\d.]+/g).map(Number)
    const composite = ([r, g, b, alpha = 1], backdrop) =>
      [r, g, b].map((channel, i) => channel * alpha + backdrop[i] * (1 - alpha))
    const luminance = rgb => rgb.reduce((sum, channel, i) => {
      const srgb = channel / 255
      const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
      return sum + linear * [0.2126, 0.7152, 0.0722][i]
    }, 0)
    const contrast = (first, second) => {
      const lighter = Math.max(luminance(first), luminance(second))
      const darker = Math.min(luminance(first), luminance(second))
      return (lighter + 0.05) / (darker + 0.05)
    }

    const surfaces = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      surfaces.unshift(rgba(getComputedStyle(parent).backgroundColor))
    }
    const backdrop = surfaces.reduce((background, surface) => composite(surface, background), [255, 255, 255])
    const background = composite(rgba(style.backgroundColor), backdrop)
    const foreground = composite(rgba(style.color), background)
    const render = rgb => composite([...rgb, Number(style.opacity)], backdrop)
    return {
      text: contrast(render(foreground), render(background)),
      focus: element.matches(':focus-visible') && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) > 0
        ? contrast(render(composite(rgba(style.outlineColor), backdrop)), backdrop)
        : 0,
    }
  })
  const label = await button.innerText()
  assert.ok(text >= 4.5, `${label} (${state}) text contrast ${text.toFixed(2)}:1 is below 4.5:1`)
  if (state === 'keyboard focus') {
    assert.ok(focus >= 3, `${label} needs a visible keyboard focus outline with at least 3:1 contrast`)
  }
}

async function assertButtonStates(page, buttons) {
  const supportsHover = await page.evaluate(() => matchMedia('(any-hover: hover)').matches)
  for (const button of await buttons.all()) {
    await page.mouse.move(0, 0)
    await button.evaluate(element => element.blur())
    await assertButtonContrast(button, 'default')
    if (supportsHover) {
      await button.hover()
      assert.equal(await button.evaluate(element => element.matches(':hover')), true)
      await assertButtonContrast(button, 'hover')
      await page.mouse.move(0, 0)
    }
    await page.keyboard.press('Tab')
    await button.focus()
    await assertButtonContrast(button, 'keyboard focus')
  }
}

try {
  for (const supportsPicker of [true, false]) {
    const context = await browser.newContext({ acceptDownloads: true })
    let downloadFails = false
    await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl.origin ? route.continue() : route.abort())
    await context.route('**/api/auth/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
    await context.route('**/api/streaming/script', route => route.fulfill({ status: downloadFails ? 503 : 200, contentType: 'text/plain', body: downloadFails ? 'Unavailable' : script }))
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(({ supportsPicker, source }) => {
      Object.defineProperty(navigator, 'platform', { value: 'Win32' })
      if (!supportsPicker) {
        window.showDirectoryPicker = undefined
        return
      }
      const state = { result: 'conflict', writes: 0 }
      window.streamingTest = state
      window.showDirectoryPicker = async () => {
        if (state.result === 'cancel') throw new DOMException('Cancelled', 'AbortError')
        if (state.result === 'denied') throw new DOMException('Denied', 'NotAllowedError')
        return {
          name: 'DZR',
          getFileHandle: async (_name, { create }) => {
            if (state.result === 'saved' && !create) throw new DOMException('Missing', 'NotFoundError')
            return {
              getFile: async () => ({ arrayBuffer: async () => new TextEncoder().encode(state.result === 'identical' ? source : state.result === 'saved' ? '' : '-- different existing file').buffer }),
              createWritable: async () => ({ write: async () => { state.writes++ }, close: async () => {} }),
            }
          },
        }
      }
    }, { supportsPicker, source: script.toString() })
    await page.goto(new URL('/streaming/setup', baseUrl).href, { waitUntil: 'networkidle', timeout: 180_000 })
    // OS detection runs after hydration; do not click the inert server HTML.
    await page.locator('button[aria-pressed="true"]').waitFor()
    const enabledButtons = page.locator('main button:visible:enabled')
    if (supportsPicker) await assertButtonStates(page, enabledButtons)
    await page.getByRole('button', { name: 'Windows', exact: true }).click()
    await page.getByRole('button', { name: 'Fortsæt', exact: true }).click()
    await assertButtonStates(page, enabledButtons)
    const next = page.getByRole('button', { name: 'Filen er klar – fortsæt', exact: true })
    const checkbox = page.getByRole('checkbox')
    const confirmation = page.getByText('Jeg har selv lagt dzr-stream.lua i en fast DZR-mappe.', { exact: true })
    const conflict = page.getByText('En download alene løser ikke konflikten.', { exact: false })
    async function assertConflict() {
      assert.equal(await conflict.isVisible(), true)
      assert.equal(await checkbox.count(), 0, 'An unresolved conflict must not offer manual confirmation')
      assert.equal(await page.getByText('Åbn Downloads / Overførsler.', { exact: false }).count(), 0, 'Manual move instructions must stay hidden')
      assert.equal(await page.getByRole('button', { name: /Hent/ }).count(), 0, 'Download must not look like a way past the conflict')
      assert.equal(await next.count(), 0, 'A conflict must hide Continue even after an earlier download or installation')
      assert.doesNotMatch((await page.getByRole('alert').allTextContents()).join(' '), /hent filen i stedet/i)
    }
    assert.equal(await next.count(), 0, 'Continue must not appear before a successful file transfer')
    assert.equal(await page.getByRole('button', { name: 'Tilbage', exact: true }).isVisible(), true)
    assert.equal(await checkbox.count(), 0, 'Manual confirmation requires a successful download')
    assert.equal(await page.getByText('Åbn Downloads / Overførsler.', { exact: false }).count(), 0)

    downloadFails = true
    await page.getByRole('button', { name: supportsPicker ? 'Hent filen i stedet' : 'Hent dzr-stream.lua', exact: true }).click()
    await page.locator('main').getByRole('alert').waitFor()
    assert.equal(await next.count(), 0, 'A failed download must not reveal Continue or manual confirmation')
    assert.equal(await checkbox.count(), 0)
    downloadFails = false

    if (supportsPicker) {
      for (const result of ['cancel', 'denied']) {
        await page.evaluate(value => { window.streamingTest.result = value }, result)
        await page.getByRole('button', { name: 'Installér DZR OBS-script', exact: true }).click()
        await page.locator('main').getByRole('alert').waitFor()
        assert.equal(await next.count(), 0, 'Cancelled or denied folder selection is not a file transfer')
        assert.equal(await page.getByRole('button', { name: 'Tilbage', exact: true }).isVisible(), true)
      }
      await page.evaluate(() => { window.streamingTest.result = 'conflict' })
    }

    async function download() {
      const [file] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: supportsPicker ? 'Hent filen i stedet' : 'Hent dzr-stream.lua', exact: true }).click(),
      ])
      assert.equal(file.suggestedFilename(), 'dzr-stream.lua')
      assert.deepEqual(await readFile(await file.path()), script)
    }
    await download()
    assert.equal(await next.isVisible(), true)
    assert.equal(await next.isDisabled(), true, 'A downloaded file still needs permanent-folder confirmation')
    await assertButtonContrast(next, 'disabled')
    await confirmation.click()
    assert.equal(await checkbox.isChecked(), true)
    assert.equal(await next.isEnabled(), true, 'Plain download still accepts manual placement')

    if (supportsPicker) {
      const scriptResponse = Promise.withResolvers()
      await context.route('**/api/streaming/script', async route => {
        await scriptResponse.promise
        await route.fulfill({ status: 200, contentType: 'text/plain', body: script })
      }, { times: 1 })
      try {
        await page.getByRole('button', { name: 'Installér DZR OBS-script', exact: true }).click()
        const loading = page.locator('main button[data-loading]')
        await loading.waitFor()
        assert.match(await loading.innerText(), /Arbejder…/)
        assert.equal(await loading.isDisabled(), true)
        await assertButtonContrast(loading, 'loading')
        for (const button of await page.locator('main button:visible:disabled:not([data-loading])').all()) {
          await assertButtonContrast(button, 'disabled while installing')
        }
      } finally {
        scriptResponse.resolve()
      }
      await conflict.waitFor()
      await assertConflict()
      await assertButtonStates(page, page.getByRole('button', { name: 'Vælg en anden mappe', exact: true }))
      assert.equal(await page.evaluate(() => window.streamingTest.writes), 0, 'Existing file must stay untouched')

      for (const result of ['cancel', 'denied']) {
        await page.evaluate(value => { window.streamingTest.result = value }, result)
        await page.getByRole('button', { name: 'Vælg en anden mappe', exact: true }).click()
        await page.getByText('Filen kunne ikke gemmes i en ny mappe. Den eksisterende fil er ikke ændret. Vælg en anden mappe, og tillad adgang.', { exact: true }).waitFor()
        await assertConflict()
      }
      await page.getByRole('button', { name: 'Tilbage', exact: true }).click()
      await page.getByRole('button', { name: 'Fortsæt', exact: true }).click()
      await assertConflict()

      for (const result of ['identical', 'saved']) {
        await page.evaluate(value => { window.streamingTest.result = value }, result)
        await page.getByRole('button', { name: 'Vælg en anden mappe', exact: true }).click()
        await page.getByText(result === 'identical' ? 'Den samme fil ligger allerede i' : 'Filen er gemt i', { exact: false }).waitFor()
        assert.equal(await conflict.count(), 0)
        assert.equal(await next.isEnabled(), true)
        assert.equal(await checkbox.isChecked(), false)
        if (result === 'identical') {
          await page.evaluate(() => { window.streamingTest.result = 'conflict' })
          await page.getByRole('button', { name: 'Installér DZR OBS-script', exact: true }).click()
          await conflict.waitFor()
          assert.equal(await next.count(), 0, 'Conflict also replaces earlier installation success')
        }
      }
      assert.equal(await page.evaluate(() => window.streamingTest.writes), 1)
      await assertButtonStates(page, next)
    }
    await next.click()
    await page.getByRole('heading', { name: 'Åbn Scripts i OBS', exact: true }).waitFor()
    if (supportsPicker) await assertButtonStates(page, enabledButtons)
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Fortsæt', exact: true }).click()
    await page.getByRole('heading', { name: 'Forbind OBS med DZR', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Kopiér adresse', exact: true }).count(), 0)
    assert.ok(!(await page.locator('main').innerText()).includes('DZR endpoint'))
    assert.ok(!(await page.locator('main').innerText()).includes('/streaming_add_new'))
    assert.ok(!(await page.locator('main').innerText()).includes('streaming-test.invalid'))
    assert.match(await page.locator('main').innerText(), /én eller flere platforme/)
    assert.match(await page.locator('main').innerText(), /finder automatisk aktive streams på dine tilmeldte YouTube- og Twitch-kanaler/)
    if (supportsPicker) await assertButtonStates(page, enabledButtons)
    await page.getByRole('button', { name: 'Jeg har udfyldt OBS', exact: true }).click()
    if (supportsPicker) await assertButtonStates(page, enabledButtons)
    await page.getByRole('button', { name: 'Vis forbindelsestest – valgfrit', exact: true }).click()
    if (supportsPicker) await assertButtonStates(page, enabledButtons)
    assert.ok(!(await page.locator('main').innerText()).includes('/streaming_add_new'))
    assert.ok(!(await page.locator('main').innerText()).includes('DZR endpoint'))
    assert.deepEqual(errors, [])
    console.log(`PASS ${supportsPicker ? 'picker conflict, sticky warning, cancellation/denial, navigation and saved/identical recovery' : 'download-only browser with manual confirmation'}`)
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
  await assertButtonStates(page, warning.locator('..').getByRole('button'))
  await page.getByRole('button', { name: 'Vis guiden alligevel', exact: true }).click()
  assert.equal(await warning.count(), 0)
  await mobile.close()
  console.log('PASS mobile warning, computer explanation, copy/dismiss controls and viewport')
} finally {
  await browser.close()
}
