import { test, expect } from '@playwright/test'
import { messages } from '../src/i18n/messages'
import { extraMessages } from '../src/i18n/extra'
import { errorMessages } from '../src/i18n/errors'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('optistock.mode', 'demo')
  })
})

test('all catalog entries contain three translations with matching parameters', () => {
  for (const [key, row] of Object.entries({ ...messages, ...extraMessages, ...errorMessages })) {
    expect(row, key).toHaveLength(3)
    const placeholders = (text: string) => [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort()
    for (const value of row) {
      expect(value.trim(), key).not.toBe('')
      expect(placeholders(value), key).toEqual(placeholders(key))
    }
  }
})

const translations = {
  en: {
    label: 'Interface language',
    nav: 'Dashboard',
    risk: 'Critical',
    chart: 'Actual sales',
    pages: [
      'Good afternoon, Aigerim',
      'From Excel to an order.',
      'Your inventory, in focus.',
      'Stronger supply connections.',
      'From insight to incoming.',
      "See what's coming next.",
      'The bigger picture, made clear.',
      'Good decisions leave a trail.',
      'A workspace that works for you.',
    ],
  },
  ru: {
    label: 'Язык интерфейса',
    nav: 'Главная',
    risk: 'Критично',
    chart: 'Фактические продажи',
    pages: [
      'Добрый день, Aigerim',
      'От Excel до заказа.',
      'Все запасы под контролем.',
      'Надёжные связи с поставщиками.',
      'От расчёта к поставке.',
      'Знайте, что потребуется дальше.',
      'Полная картина запасов.',
      'Каждое решение оставляет след.',
      'Настройте пространство под себя.',
    ],
  },
  kk: {
    label: 'Интерфейс тілі',
    nav: 'Басты бет',
    risk: 'Сындарлы',
    chart: 'Нақты сатылымдар',
    pages: [
      'Қайырлы күн, Aigerim',
      'Excel-ден тапсырысқа дейін.',
      'Барлық қорлар бақылауда.',
      'Жеткізушілермен сенімді байланыс.',
      'Есептеуден жеткізілімге дейін.',
      'Алда не қажет болатынын біліңіз.',
      'Қорлардың толық көрінісі.',
      'Әр шешімнің ізі сақталады.',
      'Кеңістікті өзіңізге бейімдеңіз.',
    ],
  },
}
const routes = [
  '/',
  '/agent',
  '/inventory',
  '/suppliers',
  '/orders',
  '/forecast',
  '/analytics',
  '/reports',
  '/settings',
]

for (const language of ['en', 'ru', 'kk'] as const) {
  test(`${language}: all pages, statuses, charts and mobile layouts use the selected language`, async ({
    page,
  }) => {
    test.setTimeout(60000)
    const copy = translations[language]
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/')
    await page.locator('.topbar .language-selector select').selectOption(language)
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    await expect(page.getByRole('combobox', { name: copy.label })).toHaveValue(language)
    await expect(page.locator('.metric-content strong').first()).toHaveText(
      language === 'en' ? '1,284' : /1\s284/,
    )
    await expect(page.locator('.sidebar nav a').first()).toHaveText(copy.nav)
    await expect(page.locator('.chart-legend')).toContainText(copy.chart)
    await expect(page.locator('.badge-critical').first()).toHaveText(copy.risk)
    await expect(page.getByText('Cable 3×2.5', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: `test-results/i18n-dashboard-${language}.png`, fullPage: true })
    for (const [i, route] of routes.entries()) {
      await page.goto(route)
      await expect(page.locator('h1')).toContainText(copy.pages[i])
      await expect(page.locator('.topbar .language-selector select')).toHaveValue(language)
    }
    // The settings selector and header selector are synchronized.
    await expect(page.getByRole('combobox', { name: copy.label })).toHaveCount(2)
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 })
      for (const [i, route] of routes.entries()) {
        await page.goto(route)
        await expect(page.locator('h1')).toContainText(copy.pages[i])
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${language} ${route} at ${width}`,
        ).toBe(true)
        await expect(page.locator('.topbar .language-selector select')).toBeVisible()
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: `test-results/i18n-settings-${language}-mobile.png`, fullPage: true })
    expect(errors).toEqual([])
  })
}

test('switching preserves scenario edits, product identifiers and saved language', async ({ page }) => {
  await page.goto('/forecast')
  await page.getByRole('spinbutton', { name: 'Expected demand growth' }).fill('37.5')
  const product = await page.getByRole('combobox', { name: 'Forecast product' }).inputValue()
  const before = await page.evaluate(() => localStorage.getItem('optistock.demo.v1'))
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
  await expect(page.getByRole('spinbutton', { name: 'Ожидаемый рост спроса' })).toHaveValue('37.5')
  await expect(page.getByRole('combobox', { name: 'Товар для прогноза' })).toHaveValue(product)
  await page.getByRole('combobox', { name: 'Язык интерфейса' }).selectOption('kk')
  await expect(page.getByRole('spinbutton', { name: 'Сұраныстың күтілетін өсімі' })).toHaveValue('37.5')
  expect(await page.evaluate(() => localStorage.getItem('optistock.demo.v1'))).toBe(before)
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Интерфейс тілі' })).toHaveValue('kk')
  await expect(page).toHaveTitle('OptiStock — Қорларды жоспарлау')
  await page.goto('/settings')
  await expect(page.locator('.dataset-setting select').first()).toContainText('2026 ж. 22 қыр.')
  await page.locator('.settings-main .language-selector select').selectOption('en')
  await expect(page.getByRole('combobox', { name: 'Interface language' }).first()).toHaveValue('en')
  await page.goto('/inventory')
  await page.getByRole('textbox', { name: 'Search products', exact: true }).fill('A120')
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ru')
  await expect(page.getByRole('textbox', { name: 'Поиск товаров', exact: true })).toHaveValue('A120')
  await expect(page.getByRole('button', { name: 'A120', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'A120', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Карточка товара' })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Cable 3×2.5' })).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Необычный спрос в истории продаж')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Как выделен регулярный спрос')).toBeVisible()
})

test('the browser language is used initially and invalid saved values fall back safely', async ({
  browser,
}) => {
  for (const [locale, expected] of [
    ['kk-KZ', 'kk'],
    ['ru-RU', 'ru'],
    ['fr-FR', 'en'],
  ]) {
    const context = await browser.newContext({ locale })
    const page = await context.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('optistock.mode', 'demo')
      localStorage.setItem('optistock.language', 'invalid')
    })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', expected)
    await expect(page.locator('.language-selector select')).toHaveValue(expected)
    await context.close()
  }
})

test('language changes synchronize between tabs without resetting form input', async ({ context, page }) => {
  await page.goto('/forecast')
  await page.getByRole('spinbutton', { name: 'Expected demand growth' }).fill('22')
  const second = await context.newPage()
  await second.goto('/')
  await second.getByRole('combobox', { name: 'Interface language' }).selectOption('kk')
  await expect(page.locator('html')).toHaveAttribute('lang', 'kk')
  await expect(page.getByRole('spinbutton', { name: 'Сұраныстың күтілетін өсімі' })).toHaveValue('22')
})
