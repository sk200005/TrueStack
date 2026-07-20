const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query) => {
  return new Promise(resolve => readline.question(query, resolve));
};

const HEADLESS_MODE = false; // Set to false to reduce bot detection

async function searchPosts(page, query) {
  console.log(`[1] Searching Quora for: "${query}" (filtering by recent)`);
  const encodedQuery = encodeURIComponent(query);
  
  // Quora uses `time=day`, `time=week`, or `time=month` for recency filters in search.
  const searchUrl = `https://www.quora.com/search?q=${encodedQuery}&time=month`;
  
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
  
  console.log('Waiting for search results to load...');
  try {
    // Wait a few seconds to let Quora's React app render the results
    await page.waitForTimeout(4000); 
  } catch (e) {
    console.log("Timeout waiting for search results.");
  }
  
  const postUrls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const urls = links.map(a => a.href).filter(href => {
      try {
        const urlObj = new URL(href);
        // Quora question URLs typically look like: https://www.quora.com/Some-Question-Title
        // They don't have secondary paths like /profile, /search, etc.
        // Exclude common footer and nav links
        const excludedPaths = ['/about', '/careers', '/contact', '/press', '/profile', '/search', '/topic', '/q'];
        
        if (urlObj.hostname.includes('quora.com') && 
            urlObj.pathname.startsWith('/') &&
            urlObj.pathname.split('/').length === 2 &&
            urlObj.pathname.length > 5 &&
            !excludedPaths.some(path => urlObj.pathname.startsWith(path))) {
          return true;
        }
        return false;
      } catch(e) {
        return false;
      }
    });
    
    // Deduplicate and slice the first 5
    return [...new Set(urls)].slice(0, 5);
  });
  
  console.log(`Found ${postUrls.length} post URLs from search.`);
  return postUrls;
}

async function extractPostData(page, url) {
  console.log(`[2] Extracting post data from: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  
  try {
    await page.locator('h1').first().waitFor({ state: 'attached', timeout: 5000 });
  } catch (e) {
    console.log("Could not find H1 (often caused by Quora's login wall).");
  }
  
  const titleLocator = page.locator('h1').first();
  const title = await titleLocator.count() > 0 ? await titleLocator.innerText() : 'Unknown Title';
  
  return { title, url };
}

async function extractComments(page) {
  console.log(`[3] Extracting answers...`);
  
  // Quora lazy-loads answers, scroll down a few times
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollBy(0, 1000));
  await page.waitForTimeout(2000);
  
  const comments = await page.evaluate(() => {
    // Quora obfuscates CSS classes (e.g. `q-text qu-wordBreak--break-word`).
    // The most robust way to extract answer bodies without relying on volatile classes
    // is finding substantial text blocks.
    
    const textBlocks = Array.from(document.querySelectorAll('.q-text.qu-wordBreak--break-word, .spacing_log_answer_content'));
    
    let validAnswers = textBlocks
      .map(el => el.innerText.trim())
      .filter(text => text.length > 70); // Filter out UI elements (Upvote, Share, small descriptions)
      
    // Deduplicate in case of nested spans catching the same text
    validAnswers = [...new Set(validAnswers)].slice(0, 10);
    
    return validAnswers.map(text => {
      return {
        author: "Unknown (Requires complex traversal due to obfuscation)",
        upvotes: "Unknown",
        text: text
      };
    });
  });
  
  console.log(`Extracted ${comments.length} answers.`);
  return comments;
}

function saveResults(data) {
  console.log(`[4] Saving results to quora-results.json`);
  fs.writeFileSync('quora-results.json', JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Results successfully saved!`);
}

async function main() {
  const query = await askQuestion("Enter Quora search query: ");
  readline.close();
  
  if (!query) {
    console.log("No query provided. Exiting.");
    return;
  }
  
  const startTime = Date.now();
  let totalCommentsScraped = 0;
  
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: HEADLESS_MODE });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  
  const page = await context.newPage();
  const finalResults = [];
  
  try {
    const postUrls = await searchPosts(page, query);
    
    for (const url of postUrls) {
      try {
        const postData = await extractPostData(page, url);
        const comments = await extractComments(page);
        
        postData.comments = comments;
        totalCommentsScraped += comments.length;
        
        finalResults.push(postData);
      } catch (err) {
        console.error(`Error processing post ${url}:`, err.message);
      }
    }
    
    saveResults(finalResults);
    
  } catch (error) {
    console.error("An error occurred during scraping:", error);
  } finally {
    await browser.close();
    const endTime = Date.now();
    const executionTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log("\n--- Scraping Summary ---");
    console.log(`Total execution time: ${executionTimeSeconds} seconds`);
    console.log(`Number of posts scraped: ${finalResults.length}`);
    console.log(`Number of comments (answers) scraped: ${totalCommentsScraped}`);
    console.log("------------------------\n");
  }
}

main();
