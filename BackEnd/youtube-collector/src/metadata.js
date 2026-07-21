const axios = require('axios');

const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const TARGET_VIDEO_COUNT = 5;

// Scoring weights removed to preserve original search ranking

/**
 * Fetches full metadata for a batch of video IDs in a single API call,
 * computes a ranking score for each, and returns the top TARGET_VIDEO_COUNT
 * sorted by that score.
 *
 * @param {string[]} videoIds - Array of YouTube video IDs
 * @param {string} apiKey - YouTube Data API v3 key
 * @returns {Promise<object[]>} Ranked array of video metadata objects
 */
async function getVideoMetadata(videoIds, apiKey) {
  console.log(`\n📊 Fetching metadata for ${videoIds.length} candidates in one batch call...`);

  const response = await axios.get(YOUTUBE_VIDEOS_URL, {
    params: {
      key: apiKey,
      id: videoIds.join(','),
      part: 'snippet,statistics,contentDetails',
    },
  });

  const items = response.data.items || [];

  // Build metadata objects and compute raw scores
  const videos = items.map((item, index) => {
    const snippet = item.snippet || {};
    const stats = item.statistics || {};
    const details = item.contentDetails || {};

    const views = parseInt(stats.viewCount || 0, 10);
    const likes = parseInt(stats.likeCount || 0, 10);


    return {
      videoId: item.id,
      title: snippet.title || '',
      channel: snippet.channelTitle || '',
      publishedAt: snippet.publishedAt || '',
      views: views,
      likes: likes,
      duration: parseDuration(details.duration || 'PT0S'),
      url: `https://www.youtube.com/watch?v=${item.id}`,
      thumbnail:
        snippet.thumbnails?.maxres?.url ||
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.medium?.url ||
        '',
      description: snippet.description || '',
    };
  });

  // Sort by original search relevance order
  videos.sort((a, b) => videoIds.indexOf(a.videoId) - videoIds.indexOf(b.videoId));
  const top = videos.slice(0, TARGET_VIDEO_COUNT * 2); // Extra buffer — transcripts will filter further

  console.log(`   Top ${Math.min(top.length, TARGET_VIDEO_COUNT)} candidates selected after ranking.`);
  return top;
}



/**
 * Converts ISO 8601 duration (e.g. PT4M13S) to a human-readable string (e.g. "4:13").
 */
function parseDuration(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '0:00';
  const h = parseInt(match[1] || 0, 10);
  const m = parseInt(match[2] || 0, 10);
  const s = parseInt(match[3] || 0, 10);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { getVideoMetadata };
