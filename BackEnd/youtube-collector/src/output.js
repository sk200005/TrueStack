const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.resolve(process.cwd(), 'youtube-results.json');

/**
 * Serializes the final result object to a formatted JSON file.
 *
 * @param {{ query: string, videos: object[] }} data
 */
function saveJson(data) {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n💾 Results saved to: ${OUTPUT_FILE}`);
}

module.exports = { saveJson };
