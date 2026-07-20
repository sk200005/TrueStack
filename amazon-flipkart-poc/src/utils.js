/**
 * Shared browser utilities used by both Amazon and Flipkart scrapers.
 */

// Patterns that indicate the current page is a CAPTCHA or block page
const BLOCK_TITLE_PATTERNS = ['robot check', 'captcha', 'access denied', 'blocked', '403 forbidden', 'page not found'];
const AMAZON_CAPTCHA_SELECTORS = ['#captchacharacters', 'form[action="/errors/validateCaptcha"]'];

/**
 * Checks whether the current page is a CAPTCHA, anti-bot, or block page.
 * Returns { blocked: boolean, reason: string }
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ blocked: boolean, reason: string }>}
 */
async function isBlockedOrCaptcha(page) {
  const title = (await page.title()).toLowerCase();

  if (BLOCK_TITLE_PATTERNS.some((p) => title.includes(p))) {
    return { blocked: true, reason: `Blocked/error page detected: "${await page.title()}"` };
  }

  const currentUrl = page.url();
  if (currentUrl.includes('validateCaptcha') || currentUrl.includes('errors/captcha')) {
    return { blocked: true, reason: 'Redirected to CAPTCHA URL' };
  }

  for (const selector of AMAZON_CAPTCHA_SELECTORS) {
    const el = await page.$(selector);
    if (el) return { blocked: true, reason: 'Amazon CAPTCHA element detected' };
  }

  return { blocked: false, reason: '' };
}

/**
 * Gently scrolls the page by a given pixel distance to trigger lazy loading.
 *
 * @param {import('playwright').Page} page
 * @param {number} [distance=800]
 */
async function smoothScroll(page, distance = 800) {
  await page.evaluate((d) => window.scrollBy({ top: d, behavior: 'smooth' }), distance);
}

module.exports = { isBlockedOrCaptcha, smoothScroll };
