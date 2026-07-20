const axios = require('axios');

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const MAX_CANDIDATES = 20; // Fetch more than needed so ranking can filter

/**
 * Searches YouTube for a query and returns candidate video IDs.
 * Fetches top MAX_CANDIDATES results sorted by relevance.
 *
 * @param {string} query - The user's search term
 * @param {string} apiKey - YouTube Data API v3 key
 * @returns {Promise<string[]>} Array of video IDs
 */
async function searchVideos(query, apiKey) {
  console.log(`\n🔍 Searching YouTube for: "${query}"`);

  const response = await axios.get(YOUTUBE_SEARCH_URL, {
    params: {
      key: apiKey,
      q: query,
      part: 'snippet',
      type: 'video',
      maxResults: MAX_CANDIDATES,
      order: 'relevance',
    },
  });

  const items = response.data.items || [];
  const videoIds = items.map((item) => item.id.videoId).filter(Boolean);

  console.log(`   Found ${videoIds.length} candidate videos.`);
  return videoIds;
}

module.exports = { searchVideos };
