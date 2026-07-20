const axios = require('axios');

const YOUTUBE_COMMENTS_URL = 'https://www.googleapis.com/youtube/v3/commentThreads';

/**
 * Fetches the top comments for a given video ID.
 *
 * @param {string} videoId - YouTube video ID
 * @param {string} apiKey - YouTube Data API v3 key
 * @param {number} maxResults - Number of comments to fetch
 * @returns {Promise<object[]>} Array of comment objects
 */
async function getTopComments(videoId, apiKey, maxResults = 3) {
  try {
    const response = await axios.get(YOUTUBE_COMMENTS_URL, {
      params: {
        key: apiKey,
        videoId: videoId,
        part: 'snippet',
        order: 'relevance',
        maxResults: maxResults,
      },
    });

    const items = response.data.items || [];
    return items.map((item) => {
      const commentSnippet = item.snippet.topLevelComment.snippet;
      return {
        author: commentSnippet.authorDisplayName,
        text: commentSnippet.textDisplay,
        likes: commentSnippet.likeCount,
        publishedAt: commentSnippet.publishedAt,
      };
    });
  } catch (err) {
    if (err.response && err.response.status === 403) {
      console.warn(`   ⚠️  Comments are disabled for video ${videoId}.`);
      return [];
    }
    console.warn(`   ⚠️  Error fetching comments for video ${videoId}: ${err.message}`);
    return [];
  }
}

module.exports = { getTopComments };
