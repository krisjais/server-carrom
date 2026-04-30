const express = require('express');
const router  = express.Router();
const Player  = require('../models/Player');
const Team    = require('../models/Team');
const Match   = require('../models/Match');

// Helper: get match count + categories for a player
async function getPlayerStats(playerId) {
  const pid = playerId.toString();

  // Singles matches
  const singleMatches = await Match.find({
    matchType: 'single',
    $or: [{ teamA: pid }, { teamB: pid }],
  });

  // Teams this player is in
  const myTeams = await Team.find({ players: pid });
  const teamIds = myTeams.map(t => t._id.toString());

  // Doubles matches via teams
  const doubleMatches = await Match.find({
    matchType: 'double',
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  });

  // Mixed matches via teams
  const mixedMatches = await Match.find({
    matchType: 'mixed',
    $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
  });

  const categories = [];
  if (singleMatches.length > 0) categories.push('single');
  if (doubleMatches.length > 0) categories.push('double');
  if (mixedMatches.length > 0)  categories.push('mixed');

  const totalMatches = singleMatches.length + doubleMatches.length + mixedMatches.length;

  return {
    categories,
    totalMatches,
    eligible: totalMatches < 3,
  };
}

// GET all players (with eligibility)
router.get('/', async (req, res) => {
  try {
    const { gender } = req.query;
    const filter  = gender ? { gender } : {};
    const players = await Player.find(filter).sort({ createdAt: 1 });

    const enriched = await Promise.all(players.map(async p => {
      const stats = await getPlayerStats(p._id);
      return { ...p.toObject(), ...stats };
    }));

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
