/**
 * Flipkart scraper module.
 * Handles search and review summary extraction with graceful fallbacks.
 *
 * NOTE: Flipkart obfuscates CSS class names on each deploy.
 * Strategy: Use structural patterns (href, title attr, ₹ prefix) instead of class names.
 */

const { isBlockedOrCaptcha, smoothScroll } = require('./utils');

const FLIPKART_BASE = 'https://www.flipkart.com';
const MAX_PRODUCTS = 10;

/**
 * Searches Flipkart for a query and returns the first MAX_PRODUCTS results.
 */
async function searchFlipkart(page, query) {
  const searchUrl = `${FLIPKART_BASE}/search?q=${encodeURIComponent(query)}&otracker=search`;
  console.log(`[Flipkart] 🔍 Searching: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: 'load', timeout: 30000 });

  // Dismiss login popup (press Escape — most reliable method)
  try {
    await page.keyboard.press('Escape');
  } catch {}

  // Also try clicking the close button if Escape didn't work
  try {
    await page.locator('button[class*="close"], button:has-text("✕"), button:has-text("×")')
      .first()
      .click({ timeout: 2000 });
  } catch {}

  const blocked = await isBlockedOrCaptcha(page);
  if (blocked.blocked) throw new Error(`[Flipkart Search] ${blocked.reason}`);

  try {
    // Wait for product links with a title attribute — these are the actual product anchors
    await page.waitForSelector('a[href*="/p/"]', { timeout: 15000 });
  } catch {
    throw new Error('[Flipkart Search] No product links appeared within timeout');
  }

  // page.evaluate only accepts ONE argument — wrap everything into an object
  const products = await page.evaluate(({ base, max }) => {
    const results = [];
    const seenUrls = new Set();

    // Flipkart product anchors reliably have href="/category/name/p/itemId"
    // The title attribute on the <a> tag contains the product name
    const anchors = Array.from(document.querySelectorAll('a[href*="/p/"]'));

    for (const anchor of anchors) {
      if (results.length >= max) break;

      // Clean the URL
      let href = anchor.href || '';
      try { href = href.split('?')[0]; } catch {}
      if (!href.startsWith(base) || seenUrls.has(href)) continue;
      seenUrls.add(href);

      // ── Name ────────────────────────────────────────────────────────────────
      // 1st choice: title attribute on the anchor (extremely stable)
      // 2nd choice: first div/span child with meaningful text
      const productName =
        anchor.getAttribute('title') ||
        anchor.querySelector('div, span')?.textContent?.trim() ||
        '';

      // ── Walk up to find the product card container ───────────────────────────
      // Flipkart cards are usually 3-5 levels above the anchor
      let card = anchor.parentElement;
      for (let depth = 0; depth < 6 && card; depth++) {
        // Stop climbing when we find a container with price info
        if (card.innerText && /₹[\d,]/.test(card.innerText)) break;
        card = card.parentElement;
      }

      // ── Price ────────────────────────────────────────────────────────────────
      // Price always starts with ₹ on Flipkart
      const allDivs = Array.from(card?.querySelectorAll('div, span') || []);
      const priceEl = allDivs.find((el) => /^₹[\d,]+$/.test(el.textContent.trim()));
      const price = priceEl?.textContent?.trim() || '';

      // ── Rating ───────────────────────────────────────────────────────────────
      // Rating is a short decimal string like "4.2" in a colored badge
      const ratingEl = allDivs.find((el) => /^\d\.\d$/.test(el.textContent.trim()));
      const rating = ratingEl?.textContent?.trim() || '';

      // ── Rating count ─────────────────────────────────────────────────────────
      // Pattern: "X,XXX Ratings" or "(X,XXX)"
      const countEl = allDivs.find((el) => /[\d,]+\s+[Rr]atings?/.test(el.textContent.trim()));
      const totalRatings = countEl?.textContent?.trim() || '';

      // ── Image ────────────────────────────────────────────────────────────────
      const imgEl = card?.querySelector('img');
      const image = imgEl?.src || '';

      results.push({ productName: productName.trim(), productUrl: href, price, rating, totalRatings, image });
    }

    // Only filter by URL — some cards may have empty names in unusual layouts
    return results.filter((p) => p.productUrl);
  }, { base: FLIPKART_BASE, max: MAX_PRODUCTS });

  console.log(`[Flipkart] ✅ Found ${products.length} products from search`);
  return products;
}

/**
 * Opens a Flipkart product page and extracts review intelligence.
 */
async function extractFlipkartReviewSummary(page, productUrl) {
  await page.goto(productUrl, { waitUntil: 'load', timeout: 30000 });

  // Dismiss login popup on product page too
  try { await page.keyboard.press('Escape'); } catch {}

  const blocked = await isBlockedOrCaptcha(page);
  if (blocked.blocked) throw new Error(`[Flipkart Product] ${blocked.reason}`);

  // Scroll to expose the review section
  await smoothScroll(page, 1000);
  await page.waitForTimeout(700);
  await smoothScroll(page, 1000);
  await page.waitForTimeout(500);

  const reviewData = await page.evaluate(() => {
    const result = {
      overallRating: '',
      totalRatings: '',
      ratingHistogram: { '5': '', '4': '', '3': '', '2': '', '1': '' },
      reviewSummary: '',
      featureRatings: [],
    };

    const fullText = document.body.innerText;
    const allEls = Array.from(document.querySelectorAll('div, span'));

    // ── Overall Rating ────────────────────────────────────────────────────────
    // It's a decimal like "4.3" inside a coloured badge near the top of the page
    const ratingEl = allEls.find((el) => {
      const text = el.textContent.trim();
      const children = el.children.length;
      return /^\d\.\d$/.test(text) && children === 0;
    });
    result.overallRating = ratingEl?.textContent?.trim() || '';

    // ── Total Ratings ─────────────────────────────────────────────────────────
    const ratingsMatch = fullText.match(/([\d,]+)\s+[Rr]atings/);
    if (ratingsMatch) result.totalRatings = ratingsMatch[0];

    // ── Rating Histogram ──────────────────────────────────────────────────────
    // Strategy: scan all elements for text matching "5★", "4★", etc. near a count
    // Flipkart renders histogram rows as: [star badge] [progress bar] [count]
    const starRows = allEls.filter((el) => {
      const text = el.textContent.trim();
      return /^[1-5]$/.test(text) && el.children.length === 0;
    });
    starRows.forEach((starEl) => {
      const starNum = starEl.textContent.trim();
      // The count is usually in a sibling element shortly after the star label
      let sibling = starEl.parentElement?.nextElementSibling;
      for (let i = 0; i < 4 && sibling; i++) {
        const text = sibling.textContent.trim();
        if (/^[\d,]+$/.test(text)) {
          result.ratingHistogram[starNum] = text;
          break;
        }
        sibling = sibling.nextElementSibling;
      }
    });

    // Fallback: parse "5★ 1,234" patterns from full page text
    if (Object.values(result.ratingHistogram).every((v) => !v)) {
      const histPattern = /([1-5])\s*★\s*([\d,]+)/g;
      let m;
      while ((m = histPattern.exec(fullText)) !== null) {
        result.ratingHistogram[m[1]] = m[2];
      }
    }

    // ── Feature Ratings ───────────────────────────────────────────────────────
    // Known feature names on Flipkart phone pages:
    const KNOWN_FEATURES = ['Camera', 'Battery', 'Display', 'Performance', 'Build Quality', 'Design', 'Value for Money', 'Overall'];
    KNOWN_FEATURES.forEach((feature) => {
      if (!fullText.includes(feature)) return;
      // Find the element containing the feature name
      const featureEl = allEls.find((el) =>
        el.textContent.trim() === feature && el.children.length === 0
      );
      if (!featureEl) return;
      // Rating is usually in a nearby sibling or cousin element
      let sibling = featureEl.parentElement?.nextElementSibling;
      for (let i = 0; i < 5 && sibling; i++) {
        const text = sibling.textContent.trim();
        if (/^\d\.\d$/.test(text)) {
          result.featureRatings.push({ feature, rating: text, mentions: '' });
          return;
        }
        sibling = sibling.nextElementSibling || sibling.parentElement?.nextElementSibling;
      }
      // Add with empty rating if feature is mentioned but rating not found nearby
      result.featureRatings.push({ feature, rating: '', mentions: '' });
    });

    // ── Review Summary ────────────────────────────────────────────────────────
    // Flipkart shows "X users found this review helpful" type cards
    // or editorial summary blocks — collect any text blocks > 80 chars near the review section
    const reviewSection = document.querySelector('section[class*="review"], div[class*="reviews"]');
    if (reviewSection) {
      const summaryEls = Array.from(reviewSection.querySelectorAll('p, div')).filter(
        (el) => el.children.length === 0 && el.textContent.trim().length > 80
      );
      if (summaryEls.length > 0) {
        result.reviewSummary = summaryEls
          .slice(0, 3)
          .map((el) => el.textContent.trim())
          .join(' | ');
      }
    }

    return result;
  });

  return reviewData;
}

module.exports = { searchFlipkart, extractFlipkartReviewSummary };
