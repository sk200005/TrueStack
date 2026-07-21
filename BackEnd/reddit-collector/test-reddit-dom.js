const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  await page.goto('https://www.reddit.com/r/tressless/comments/xk3622/head_massages_do_work_for_tight_scalps_especially/', { waitUntil: 'domcontentloaded' });
  
  await page.waitForTimeout(5000);
  
  const data = await page.evaluate(() => {
    const post = document.querySelector('shreddit-post');
    const postHTML = post ? post.outerHTML.substring(0, 500) : null;
    const comments = Array.from(document.querySelectorAll('shreddit-comment')).slice(0, 2);
    return {
      postHTML,
      comments: comments.map(c => ({
        attributes: Array.from(c.attributes).map(a => ({ name: a.name, value: a.value })),
        html: c.outerHTML.substring(0, 500)
      }))
    };
  });
  
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
}
main();
