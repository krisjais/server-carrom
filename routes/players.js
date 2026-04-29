const express = require('express');
const router = express.Router();
const Player = require('../models/Player');

// GET all players
router.get('/', async (req, res) => {
  try {
    const { gender } = req.query;
    const filter = gender ? { gender } : {};
    const players = await Player.find(filter).sort({ createdAt: 1 });
    res.json(players);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create player
router.post('/', async (req, res) => {
  try {
    const { name, gender } = req.body;
    if (!name || !gender) return res.status(400).json({ error: 'Name and gender are required' });
    const player = await Player.create({ name, gender });
    res.status(201).json(player);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update player
router.put('/:id', async (req, res) => {
  try {
    const player = await Player.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json(player);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE player
router.delete('/:id', async (req, res) => {
  try {
    await Player.findByIdAndDelete(req.params.id);
    res.json({ message: 'Player deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
