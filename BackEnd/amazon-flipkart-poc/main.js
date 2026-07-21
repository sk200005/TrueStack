/**
 * Amazon & Flipkart Review Intelligence — Proof of Concept
 *
 * Orchestrates parallel scraping of both platforms using a single browser instance.
 * Outputs: amazon-results.json, flipkart-results.json, combined-results.json
 */

const readline = require('readline');
const { searchAmazon, extractAmazonReviewSummary } = require('./src/amazon');
const { searchFlipkart, extractFlipkartReviewSummary } = require('./src/flipkart');
const { normalizeAmazon, normalizeFlipkart } = require('./src/normalizer');
const { saveJson } = require('./src/output');

// ── Browser Setup ─────────────────────────────────────────────────────────────
// Try to use playwright-extra with stealth (installed in parent node_modules).
// If not available, fall back to standard playwright gracefully.
let chromium;
(function loadBrowser() {
  try {
    const extra = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth')();
    extra.chromium.use(stealth);
    chromium = extra.chromium;
    console.log('✓ Using playwright-extra with stealth plugin');
  } catch {
    chromium = require('playwright').chromium;
    console.log('⚠ playwright-extra not found — using standard playwright (higher detection risk)');
  }
})();

// ── Terminal Prompt ───────────────────────────────────────────────────────────
function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, (ans) => { rl.close(); resolve(ans.trim()); }));
}

// ── Amazon Pipeline ───────────────────────────────────────────────────────────
/**
 * Creates an isolated browser context for Amazon, runs search + per-product
 * review extraction, and returns an array of normalized product objects.
 */
async function processAmazon(browser, query) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  const page = await context.newPage();

  const results = [];
  const skipped = [];

  try {
    const products = await searchAmazon(page, query);

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`[Amazon] ▶ (${i + 1}/${products.length}) "${product.productName}"`);

      try {
        const reviewData = await extractAmazonReviewSummary(page, product.productUrl);
        const normalized = normalizeAmazon(product, reviewData);
        results.push(normalized);

        const hasReviewSummary = !!normalized.reviewSummary;
        const featureCount = normalized.featureRatings.length;
        console.log(`[Amazon]    ✅ Extracted — AI summary: ${hasReviewSummary ? 'Yes' : 'No'} | Features: ${featureCount}`);
      } catch (err) {
        console.warn(`[Amazon]    ⏭  Skipped — ${err.message}`);
        skipped.push({ productName: product.productName, reason: err.message });
      }
    }
  } catch (err) {
    console.error(`[Amazon] ❌ Fatal search error: ${err.message}`);
  } finally {
    await context.close();
  }

  return { results, skipped };
}

// ── Flipkart Pipeline ─────────────────────────────────────────────────────────
/**
 * Creates an isolated browser context for Flipkart, runs search + per-product
 * review extraction, and returns an array of normalized product objects.
 */
async function processFlipkart(browser, query) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  });
  const page = await context.newPage();

  const results = [];
  const skipped = [];

  try {
    const products = await searchFlipkart(page, query);

    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`[Flipkart] ▶ (${i + 1}/${products.length}) "${product.productName}"`);

      try {
        const reviewData = await extractFlipkartReviewSummary(page, product.productUrl);
        const normalized = normalizeFlipkart(product, reviewData);
        results.push(normalized);

        const hasReviewSummary = !!normalized.reviewSummary;
        const featureCount = normalized.featureRatings.length;
        console.log(`[Flipkart]    ✅ Extracted — Review summary: ${hasReviewSummary ? 'Yes' : 'No'} | Features: ${featureCount}`);
      } catch (err) {
        console.warn(`[Flipkart]    ⏭  Skipped — ${err.message}`);
        skipped.push({ productName: product.productName, reason: err.message });
      }
    }
  } catch (err) {
    console.error(`[Flipkart] ❌ Fatal search error: ${err.message}`);
  } finally {
    await context.close();
  }

  return { results, skipped };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const query = await askQuestion('\nEnter product search query: ');
  if (!query) { console.error('❌ No query entered.'); process.exit(1); }

  const startTime = Date.now();

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Amazon & Flipkart Review Intelligence POC');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Query: "${query}"`);
  console.log('  Running Amazon and Flipkart scrapers in parallel...\n');

  // Single browser instance shared by both pipelines
  const browser = await chromium.launch({ headless: false });

  let amazonData = { results: [], skipped: [] };
  let flipkartData = { results: [], skipped: [] };

  try {
    // Run both platforms in parallel — each gets its own isolated context
    [amazonData, flipkartData] = await Promise.all([
      processAmazon(browser, query),
      processFlipkart(browser, query),
    ]);
  } finally {
    await browser.close();
  }

  // Save platform-specific output files
  saveJson('amazon-results.json', {
    query,
    source: 'Amazon India',
    scrapedAt: new Date().toISOString(),
    products: amazonData.results,
  });

  saveJson('flipkart-results.json', {
    query,
    source: 'Flipkart',
    scrapedAt: new Date().toISOString(),
    products: flipkartData.results,
  });

  // Save combined output
  saveJson('combined-results.json', {
    query,
    scrapedAt: new Date().toISOString(),
    products: [...amazonData.results, ...flipkartData.results],
  });

  // ── Summary ─────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const allSkipped = [...amazonData.skipped, ...flipkartData.skipped];

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Query                  : "${query}"`);
  console.log(`  Amazon products saved  : ${amazonData.results.length}`);
  console.log(`  Flipkart products saved: ${flipkartData.results.length}`);
  console.log(`  Total products saved   : ${amazonData.results.length + flipkartData.results.length}`);
  console.log(`  Products skipped       : ${allSkipped.length}`);
  if (allSkipped.length > 0) {
    allSkipped.forEach((s) => console.log(`    • "${s.productName}" → ${s.reason}`));
  }
  console.log(`  Total execution time   : ${elapsed}s`);
  console.log('══════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('❌ Unhandled error:', err.message);
  process.exit(1);
});
