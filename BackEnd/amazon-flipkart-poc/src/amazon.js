/**
 * Amazon India scraper module.
 * Handles search and review summary extraction with graceful fallbacks.
 */

const { isBlockedOrCaptcha, smoothScroll } = require('./utils');

const AMAZON_BASE = 'https://www.amazon.in';
const MAX_PRODUCTS = 10;
const SEARCH_RESULT_SELECTOR = '[data-component-type="s-search-result"]';

/**
 * Searches Amazon India for a query and returns the first MAX_PRODUCTS results.
 */
async function searchAmazon(page, query) {
  const searchUrl = `${AMAZON_BASE}/s?k=${encodeURIComponent(query)}`;
  console.log(`[Amazon] 🔍 Searching: ${searchUrl}`);

  // Use 'load' so that JS-rendered content is present before we evaluate
  await page.goto(searchUrl, { waitUntil: 'load', timeout: 30000 });

  const blocked = await isBlockedOrCaptcha(page);
  if (blocked.blocked) throw new Error(`[Amazon Search] ${blocked.reason}`);

  try {
    await page.waitForSelector(SEARCH_RESULT_SELECTOR, { timeout: 15000 });
  } catch {
    throw new Error('[Amazon Search] Search results did not load within timeout');
  }

  // page.evaluate only accepts ONE argument — wrap everything into an object
  const products = await page.evaluate(({ selector, max, base }) => {
    const cards = Array.from(document.querySelectorAll(selector)).slice(0, max);

    return cards.map((el) => {
      // ── Name ──────────────────────────────────────────────────────────────
      // Use the h2 text content directly — most stable across Amazon UI variants
      const h2 = el.querySelector('h2');
      const productName = h2?.textContent?.trim() || '';

      // ── URL ───────────────────────────────────────────────────────────────
      // Amazon product URLs always contain /dp/<ASIN>
      const linkEl = h2?.querySelector('a') || el.querySelector('a[href*="/dp/"]');
      let href = linkEl?.getAttribute('href') || '';
      if (href && !href.startsWith('http')) href = base + href;
      try { href = href.split('/ref=')[0]; } catch {}

      // ── Price ─────────────────────────────────────────────────────────────
      const priceEl = el.querySelector('.a-price .a-offscreen');

      // ── Rating ────────────────────────────────────────────────────────────
      // aria-label is more reliable than the visual icon text
      const starEl = el.querySelector('[aria-label*="out of 5 stars"]') ||
                     el.querySelector('span.a-icon-alt');
      const rating = (starEl?.getAttribute('aria-label') || starEl?.textContent || '')
        .replace(' out of 5 stars', '').trim();

      // ── Review count ──────────────────────────────────────────────────────
      const countEl = el.querySelector('[aria-label*="ratings"]') ||
                      el.querySelector('.s-link-style .s-underline-text') ||
                      el.querySelector('span.a-size-base.s-underline-text');
      const totalRatings = (countEl?.getAttribute('aria-label') || countEl?.textContent || '').trim();

      // ── Image ─────────────────────────────────────────────────────────────
      const imgEl = el.querySelector('img.s-image');

      return {
        productName,
        productUrl: href,
        price: priceEl?.textContent?.trim() || '',
        rating,
        totalRatings,
        image: imgEl?.src || '',
      };
    // Only require a URL — names may be missing for some card types
    }).filter((p) => p.productUrl);
  }, { selector: SEARCH_RESULT_SELECTOR, max: MAX_PRODUCTS, base: AMAZON_BASE });

  console.log(`[Amazon] ✅ Found ${products.length} products from search`);
  return products;
}

/**
 * Opens an Amazon product page and extracts review intelligence:
 * overall rating, histogram, AI summary ("Customers say"), and feature aspects.
 */
async function extractAmazonReviewSummary(page, productUrl) {
  await page.goto(productUrl, { waitUntil: 'load', timeout: 30000 });

  const blocked = await isBlockedOrCaptcha(page);
  if (blocked.blocked) throw new Error(`[Amazon Product] ${blocked.reason}`);

  try {
    await page.waitForSelector('#dp, #ppd, #feature-bullets', { timeout: 15000 });
  } catch { /* continue */ }

  // Scroll to trigger lazy-loaded review section
  await smoothScroll(page, 900);
  await page.waitForTimeout(800);
  await smoothScroll(page, 900);
  await page.waitForTimeout(600);

  const reviewData = await page.evaluate(() => {
    const result = {
      overallRating: '',
      totalRatings: '',
      ratingHistogram: { '5': '', '4': '', '3': '', '2': '', '1': '' },
      reviewSummary: '',
      featureRatings: [],
    };

    // ── Overall Rating ────────────────────────────────────────────────────────
    // Try data-hook first (most stable), then ARIA attributes, then icon text
    const ratingEl =
      document.querySelector('[data-hook="rating-out-of-text"]') ||
      document.querySelector('#acrPopover [title]') ||
      document.querySelector('#acrPopover .a-icon-alt') ||
      document.querySelector('span.reviewCountTextLinkedHistogram .a-icon-alt');
    const ratingRaw =
      ratingEl?.getAttribute('title') ||
      ratingEl?.getAttribute('aria-label') ||
      ratingEl?.textContent || '';
    result.overallRating = ratingRaw.replace(' out of 5 stars', '').trim();

    // ── Total Ratings ─────────────────────────────────────────────────────────
    const totalEl =
      document.querySelector('[data-hook="total-review-count"]') ||
      document.querySelector('#acrCustomerReviewText');
    result.totalRatings = totalEl?.textContent?.trim() || '';

    // ── Rating Histogram ──────────────────────────────────────────────────────
    // Amazon renders: <tr> <td>5 star</td> <td>[bar]</td> <td>72%</td> </tr>
    const histRows = document.querySelectorAll('#histogramTable tr, table.a-histogram tr');
    histRows.forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) return;
      const labelText = cells[0]?.textContent?.trim() || '';
      const starMatch = labelText.match(/(\d)\s*star/i) || labelText.match(/^([1-5])\b/);
      const star = starMatch?.[1];
      const pctCell = cells[cells.length - 1];
      const pctText = (pctCell?.querySelector('a')?.textContent || pctCell?.textContent || '').trim();
      if (star && result.ratingHistogram[star] !== undefined && pctText) {
        result.ratingHistogram[star] = pctText;
      }
    });

    // ── AI Review Summary ("Customers say") ───────────────────────────────────
    const summaryCandidates = [
      '[data-hook="cr-insights-widget-review-text"] p',
      '[data-hook="cr-insights-widget-review-text"]',
      '#cr-dp-summarization-attributes p',
      '#cr-dp-summarization-attributes',
      '[data-hook="cr-insights-widget"] p',
      '[data-hook="cr-insights-widget"]',
    ];
    for (const sel of summaryCandidates) {
      const el = document.querySelector(sel);
      if (el?.textContent?.trim()) { result.reviewSummary = el.textContent.trim(); break; }
    }

    // ── Feature Aspects ───────────────────────────────────────────────────────
    const aspectEls = [
      ...document.querySelectorAll('[data-hook="cr-insights-widget-aspect"]'),
      ...document.querySelectorAll('[data-hook="cr-insights-widget-aspect-item"]'),
    ];
    if (aspectEls.length > 0) {
      aspectEls.forEach((el) => {
        const nameEl =
          el.querySelector('[data-hook="cr-insights-widget-aspect-name"]') || el.querySelector('span');
        const mentionEl = el.querySelector('[data-hook="cr-insights-widget-aspect-mention-count"]');
        if (nameEl?.textContent?.trim()) {
          result.featureRatings.push({
            feature: nameEl.textContent.trim(),
            rating: '',
            mentions: mentionEl?.textContent?.trim() || '',
          });
        }
      });
    } else {
      document.querySelectorAll('#cr-dp-summarization-attributes li').forEach((li) => {
        const text = li.textContent.trim();
        if (text) result.featureRatings.push({ feature: text, rating: '', mentions: '' });
      });
    }

    return result;
  });

  return reviewData;
}

module.exports = { searchAmazon, extractAmazonReviewSummary };
