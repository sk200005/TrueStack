/**
 * Normalizes raw scraped data from Amazon and Flipkart into a shared schema.
 * This makes combined-results.json directly comparable and LLM-ready.
 */

/**
 * @param {object} searchResult - Product from searchAmazon()
 * @param {object} reviewData   - Review data from extractAmazonReviewSummary()
 * @returns {object} Normalized product object
 */
function normalizeAmazon(searchResult, reviewData) {
  return {
    source: 'Amazon',
    productName: searchResult.productName,
    price: searchResult.price,
    rating: reviewData.overallRating || searchResult.rating,
    totalRatings: reviewData.totalRatings || searchResult.totalRatings,
    image: searchResult.image,
    productUrl: searchResult.productUrl,
    reviewSummary: reviewData.reviewSummary,
    ratingHistogram: reviewData.ratingHistogram,
    featureRatings: reviewData.featureRatings,
  };
}

/**
 * @param {object} searchResult - Product from searchFlipkart()
 * @param {object} reviewData   - Review data from extractFlipkartReviewSummary()
 * @returns {object} Normalized product object
 */
function normalizeFlipkart(searchResult, reviewData) {
  return {
    source: 'Flipkart',
    productName: searchResult.productName,
    price: searchResult.price,
    rating: reviewData.overallRating || searchResult.rating,
    totalRatings: reviewData.totalRatings || searchResult.totalRatings,
    image: searchResult.image,
    productUrl: searchResult.productUrl,
    reviewSummary: reviewData.reviewSummary,
    ratingHistogram: reviewData.ratingHistogram,
    featureRatings: reviewData.featureRatings,
  };
}

module.exports = { normalizeAmazon, normalizeFlipkart };
