const fs = require('fs');
const path = require('path');

/**
 * Serializes data to a formatted JSON file in the project root.
 *
 * @param {string} filename - e.g. 'amazon-results.json'
 * @param {any} data
 */
function saveJson(filename, data) {
  const filepath = path.resolve(process.cwd(), filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`💾 Saved: ${filepath}`);
}

module.exports = { saveJson };
