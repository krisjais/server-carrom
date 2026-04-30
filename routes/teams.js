const express = require('express');
const router  = express.Router();
const Team    = require('../models/Team');
const Player  = require('../models/Player');
const Match   = require('../models/Match');

// GET all teams (optionally filter by matchType)
router.get('/', async (req, res) => {
  try {
    const { matchType } = req.query;
    const filter = matchType ? { matchType } : {};
    const teams = await Team.find(filter).populate('players');
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create a team manually
// Body: { playerIds: [id1, id2], matchType: 'double'|'mixed' }
router.post('/', async (req, res) => {
  try {
    const { playerIds, matchType } = req.body;

    if (!playerIds || playerIds.length !== 2) {
      return res.status(400).json({ error: 'Exactly 2 player IDs required' });
    }
    if (!['double', 'mixed'].includes(matchType)) {
      return res.status(400).json({ error: 'matchType must be double or mixed' });
    }

    const players = await Player.find({ _id: { $in: playerIds } });
    if (players.length !== 2) {
      return res.status(404).json({ error: 'One or more players not found' });
    }

    // Validate mixed: must be 1 male + 1 female
    if (matchType === 'mixed') {
      const genders = players.map(p => p.gender);
      if (!genders.includes('male') || !genders.includes('female')) {
        return res.status(400).json({ error: 'Mixed doubles team must have 1 Male and 1 Female player' });
      }
    }

    // Check if either player is already in a team for this matchType
    const existing = await Team.findOne({
      matchType,
      players: { $in: playerIds },
    });
    if (existing) {
      return res.status(400).json({ error: 'One or more players are already in a team for this category' });
    }

    const team = await Team.create({ players: playerIds, matchType });
    await team.populate('players');
    res.status(201).json(team);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a team
router.delete('/:id', async (req, res) => {
  try {
    await Team.findByIdAndDelete(req.params.id);
    res.json({ message: 'Team deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST generate matches from manually created teams
// Body: { matchType: 'double'|'mixed' }
router.post('/generate-matches', async (req, res) => {
  try {
    const { matchType } = req.body;
    if (!['double', 'mixed'].includes(matchType)) {
      return res.status(400).json({ error: 'matchType must be double or mixed' });
    }

    const teams = await Team.find({ matchType });
    if (teams.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 teams to generate matches' });
    }

    // Clear existing matches for this type
    await Match.deleteMany({ matchType });

    // Shuffle teams
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    const matches  = [];
    let pos = 0;

    for (let i = 0; i < shuffled.length; i += 2) {
      const a    = shuffled[i];
      const b    = shuffled[i + 1];
      const isBye = !b;

      matches.push({
        matchType,
        genderGroup: 'open',
        round: 1,
        bracketPosition: pos++,
        teamA:      a._id,
        teamAModel: 'Team',
        teamB:      isBye ? null : b._id,
        teamBModel: isBye ? null : 'Team',
        isBye,
        status:      isBye ? 'completed' : 'upcoming',
        winner:      isBye ? a._id : null,
        winnerModel: isBye ? 'Team' : null,
      });
    }

    await Match.insertMany(matches);
    res.json({ message: `${matches.length} matches generated from ${teams.length} teams` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
