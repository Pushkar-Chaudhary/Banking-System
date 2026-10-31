const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const app = require('../src/app');
const { validateMealRequest } = require('../src/controllers/meal.controller');
const {
  attachAvailableProducts,
  buildMealPrompt,
  FOOD_CATEGORY_PATTERN,
  generateMealRecommendations
} = require('../src/services/meal-recommendation.service');

test('meal requests validate supported meal types, servings, and preferences', () => {
  assert.deepEqual(validateMealRequest({
    meal: 'breakfast',
    servings: 2,
    preferences: 'vegetarian'
  }), {
    value: { meal: 'breakfast', servings: 2, preferences: 'vegetarian', excludeIdeas: [] }
  });
  assert.match(validateMealRequest({ meal: 'midnight', servings: 2 }).error, /valid meal/);
  assert.match(validateMealRequest({ meal: 'lunch', servings: 0 }).error, /1 and 8/);
  assert.match(validateMealRequest({ meal: 'lunch', servings: 2, preferences: 'x'.repeat(241) }).error, /240/);
  assert.match(validateMealRequest({
    meal: 'lunch',
    servings: 2,
    excludeIdeas: [{ title: 'Meal', productIds: ['invalid'] }]
  }).error, /Recent meal ideas/);
  assert.equal(validateMealRequest({
    meal: 'lunch',
    servings: 2,
    excludeIdeas: [{ title: 'Beans on toast', productIds: ['a'.repeat(24)] }]
  }).value.excludeIdeas[0].title, 'Beans on toast');
});

test('meal catalog filtering recognizes grocery categories but excludes non-food categories', () => {
  assert.equal(FOOD_CATEGORY_PATTERN.test('Vegetables'), true);
  assert.equal(FOOD_CATEGORY_PATTERN.test('Grocery'), true);
  assert.equal(FOOD_CATEGORY_PATTERN.test('Home and household'), false);
  assert.equal(FOOD_CATEGORY_PATTERN.test('Medical supplies'), false);
});

test('meal prompts include only the catalog facts needed to ground suggestions', () => {
  const prompt = buildMealPrompt({
    meal: 'day',
    servings: 2,
    preferences: 'vegetarian',
    excludeIdeas: [{ title: 'Old breakfast', productIds: ['a'.repeat(24)] }],
    products: [{ _id: 'abc123', name: 'Local beans', category: 'grocery', price: 180 }]
  });

  assert.match(prompt, /breakfast, lunch, and dinner/);
  assert.match(prompt, /Plan for 2 people/);
  assert.match(prompt, /vegetarian/);
  assert.match(prompt, /"id":"abc123"/);
  assert.match(prompt, /"priceNPR":180/);
  assert.match(prompt, /Old breakfast/);
  assert.doesNotMatch(prompt, /seller|images|stock/i);
});

test('meal ideas include only matching suggestions and products from the live catalog', () => {
  const catalog = [
    { _id: 'a'.repeat(24), name: 'Local beans', price: 180 },
    { _id: 'b'.repeat(24), name: 'Fresh greens', price: 120 }
  ];
  const result = attachAvailableProducts({
    summary: 'A simple meal from local groceries.',
    ideas: [
      {
        mealType: 'breakfast',
        title: 'Beans on toast',
        description: 'A warm, filling start.',
        productIds: ['a'.repeat(24), 'c'.repeat(24), 'a'.repeat(24)]
      },
      {
        mealType: 'dinner',
        title: 'Greens and beans',
        description: 'A simple, hearty dinner.',
        productIds: ['b'.repeat(24)]
      },
      {
        mealType: 'breakfast',
        title: 'Warm local beans',
        description: 'A different title with the same ingredients.',
        productIds: ['a'.repeat(24)]
      }
    ]
  }, catalog, 'breakfast');

  assert.equal(result.ideas.length, 1);
  assert.equal(result.ideas[0].mealType, 'breakfast');
  assert.deepEqual(result.ideas[0].products, [catalog[0]]);
});

test('meal ideas exclude recent titles and product combinations but keep new suggestions', () => {
  const catalog = [
    { _id: 'a'.repeat(24), name: 'Local beans', price: 180 },
    { _id: 'b'.repeat(24), name: 'Fresh greens', price: 120 }
  ];
  const result = attachAvailableProducts({
    summary: 'Try a different way to enjoy local beans.',
    ideas: [
      {
        mealType: 'breakfast',
        title: 'Beans on toast',
        description: 'An earlier title.',
        productIds: ['a'.repeat(24)]
      },
      {
        mealType: 'breakfast',
        title: 'Different title, same products',
        description: 'An earlier product combination.',
        productIds: ['b'.repeat(24)]
      },
      {
        mealType: 'breakfast',
        title: 'New bean breakfast',
        description: 'A new, simple breakfast idea.',
        productIds: ['a'.repeat(24)]
      }
    ]
  }, catalog, 'breakfast', [{ title: 'BEANS ON TOAST', productIds: ['b'.repeat(24)] }]);

  assert.equal(result.ideas.length, 1);
  assert.equal(result.ideas[0].title, 'New bean breakfast');
  assert.equal(result.ideas[0].mealType, 'breakfast');
  assert.deepEqual(result.ideas[0].products, [catalog[0]]);
});

test('meal ideas fail explicitly when no suggested products match the catalog', () => {
  assert.throws(() => attachAvailableProducts({
    summary: 'No matching products.',
    ideas: [{
      mealType: 'lunch',
      title: 'Meal',
      description: 'A meal idea.',
      productIds: ['a'.repeat(24)]
    }]
  }, [], 'lunch'), /available products/);
});

test('meal generation uses the server Gemini key and returns catalog-backed structured ideas', async () => {
  const product = { _id: 'a'.repeat(24), name: 'Local beans', category: 'grocery', price: 180, stock: 5 };
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestKey = '';

  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    requestKey = new Headers(options.headers).get('x-goog-api-key');
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              summary: 'A quick, hearty breakfast.',
              ideas: [{
                mealType: 'breakfast',
                title: 'Warm local beans',
                description: 'A simple, filling start.',
                productIds: [product._id]
              }]
            })
          }]
        },
        finishReason: 'STOP'
      }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 40, totalTokenCount: 60 }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    const result = await generateMealRecommendations({
      meal: 'breakfast',
      servings: 2,
      preferences: '',
      products: [product],
      apiKey: 'server-only-test-key'
    });

    assert.match(requestUrl, /models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(requestKey, 'server-only-test-key');
    assert.equal(result.ideas[0].products[0], product);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('meal recommendation endpoint validates input and reports missing server configuration', async () => {
  const server = http.createServer(app);
  const previousApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  try {
    const invalidRequest = await fetch(`${origin}/api/v1/meals/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meal: 'midnight', servings: 2 })
    });
    assert.equal(invalidRequest.status, 400);
    assert.match((await invalidRequest.json()).message, /valid meal/);

    const unconfiguredRequest = await fetch(`${origin}/api/v1/meals/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meal: 'breakfast', servings: 2 })
    });
    assert.equal(unconfiguredRequest.status, 503);
    assert.match((await unconfiguredRequest.json()).message, /not configured/);
  } finally {
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
