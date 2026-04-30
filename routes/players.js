const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const Team   = require('../models/Team');
const Match  = require('../models/Match');

// GET all players (with eligibility info)
router.get('/', async (req, res) => {
  try {
    const { gender } = req.query;
    const filter = gender ? { gender } : {};
    const players = await Player.find(filter).sort({ createdAt: 1 });

    // Check eligibility: has player participated in all 3 categories?
    const allTeams   = await Team.find();
    const allMatches = await Match.find({ matchType: { $in: ['single', 'double', 'mixed'] } });

    const enriched = players.map(player => {
      const pid = player._id.toString();
      const cats = new Set();

      // Singles
      const inSingle = allMatches.some(m =>
        m.matchType === 'single' && (
          m.teamA?.toString() === pid || m.teamB?.toString() === pid
        )
      );
      if (inSingle) cats.add('single');

      // Doubles / Mixed via teams
      const myTeams = allTeams.filter(t => t.players?.some(p => p.toString() === pid));
      myTeams.forEach(t => {
        if (t.matchType === 'double') cats.add('double');
        if (t.matchType === 'mixed')  cats.add('mixed');
      });

      return {
        ...player.toObject(),
        categories:  [...cats],
        playedAll3:  cats.size >= 3,
        eligible:    cats.size < 3,
      };
    });

    res.json(enriched);
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
