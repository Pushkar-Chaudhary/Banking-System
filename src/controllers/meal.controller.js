const Product = require('../models/product.model');
const { generateMealRecommendations, FOOD_CATEGORY_PATTERN } = require('../services/meal-recommendation.service');
const { serverError } = require('../services/http.service');

const MEAL_TYPES = new Set(['day', 'breakfast', 'lunch', 'dinner', 'snack']);

function validateMealRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Choose a meal and the number of people.' };
  }
  if (!MEAL_TYPES.has(body.meal)) {
    return { error: 'Choose a valid meal.' };
  }
  if (!Number.isInteger(body.servings) || body.servings < 1 || body.servings > 8) {
    return { error: 'Choose between 1 and 8 servings.' };
  }
  if (body.preferences !== undefined
    && (typeof body.preferences !== 'string' || body.preferences.length > 240)) {
    return { error: 'Meal preferences must be 240 characters or fewer.' };
  }
  if (body.excludeIdeas !== undefined
    && (!Array.isArray(body.excludeIdeas) || body.excludeIdeas.length > 9
      || body.excludeIdeas.some((idea) => !idea || typeof idea !== 'object'
        || typeof idea.title !== 'string' || !idea.title.trim() || idea.title.length > 80
        || !Array.isArray(idea.productIds) || idea.productIds.length < 1 || idea.productIds.length > 3
        || idea.productIds.some((id) => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))))) {
    return { error: 'Recent meal ideas must contain up to 9 valid suggestions.' };
  }
  return {
    value: {
      meal: body.meal,
      servings: body.servings,
      preferences: (body.preferences || '').trim(),
      excludeIdeas: (body.excludeIdeas || []).map((idea) => ({
        title: idea.title.trim(),
        productIds: idea.productIds
      }))
    }
  };
}

async function getMealRecommendations(req, res) {
  const validation = validateMealRequest(req.body);
  if (validation.error) {
    return res.status(400).json({ message: validation.error });
  }
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ message: 'AI meal suggestions are not configured yet.' });
  }

  let products;
  try {
    products = await Product.find({
      isActive: true,
      sellerModeActive: true,
      stock: { $gt: 0 },
      'location.country': 'Nepal',
      category: FOOD_CATEGORY_PATTERN
    })
      .select('name category price images stock location')
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();
  } catch (error) {
    return serverError(res, 'Unable to load food products for meal suggestions', error);
  }

  if (!products.length) {
    return res.status(409).json({ message: 'There are no in-stock food products to plan a meal with yet.' });
  }

  try {
    const recommendations = await generateMealRecommendations({
      ...validation.value,
      products,
      apiKey: process.env.GEMINI_API_KEY
    });
    return res.json(recommendations);
  } catch (error) {
    console.error('Meal idea generation failed:', {
      name: error?.name || 'Error',
      statusCode: error?.statusCode
    });
    return res.status(502).json({ message: 'Meal ideas are temporarily unavailable. Please try again shortly.' });
  }
}

module.exports = { getMealRecommendations, validateMealRequest };
