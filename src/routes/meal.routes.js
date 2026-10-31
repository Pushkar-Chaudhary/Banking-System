const express = require('express');
const { getMealRecommendations } = require('../controllers/meal.controller');

const router = express.Router();

router.post('/recommendations', getMealRecommendations);

module.exports = router;
