const express = require('express');
const router = express.Router();
const Match = require('../models/Match');
const Player = require('../models/Player');
const Team = require('../models/Team');
const { generateSingleMatches, generateDoubleMatches, generateMixedMatches } = require('../utils/matchGenerator');

// GET matches
router.get('/', async (req, res) => {
  try {
    const { matchType } = req.query;
    const filter = matchType ? { matchType } : {};
    const matches = await Match.find(filter)
      .populate('teamA')
      .populate('teamB')
      .populate('winner')
      .sort({ round: 1, bracketPosition: 1 });

    // Manually populate team players for doubles/mixed
    const populated = await Promise.all(matches.map(async (match) => {
      const m = match.toObject();
      if (m.teamAModel === 'Team' && m.teamA) {
        const team = await Team.findById(m.teamA._id || m.teamA).populate('players');
        m.teamA = team;
      }
      if (m.teamBModel === 'Team' && m.teamB) {
        const team = await Team.findById(m.teamB._id || m.teamB).populate('players');
        m.teamB = team;
      }
      return m;
    }));

    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST generate matches
router.post('/generate', async (req, res) => {
  try {
    const { matchType } = req.body;
    if (!matchType) return res.status(400).json({ error: 'matchType is required' });

    // Clear existing matches of this type
    await Match.deleteMany({ matchType });

    let message = '';
    if (matchType === 'single') {
      await generateSingleMatches();
      message = 'Singles matches generated successfully';
    } else if (matchType === 'double') {
      await generateDoubleMatches();
      message = 'Doubles matches generated successfully';
    } else if (matchType === 'mixed') {
      await generateMixedMatches();
      message = 'Mixed doubles matches generated successfully';
    } else {
      return res.status(400).json({ error: 'Invalid matchType' });
    }

    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update match result
router.put('/:id/result', async (req, res) => {
  try {
    const { scoreA, scoreB, winner, status } = req.body;
    const match = await Match.findByIdAndUpdate(
      req.params.id,
      { scoreA, scoreB, winner, status },
      { new: true }
    ).populate('teamA').populate('teamB');

    if (!match) return res.status(404).json({ error: 'Match not found' });
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST advance winners to next round
router.post('/advance', async (req, res) => {
  try {
    const { matchType, round } = req.body;
    const completedMatches = await Match.find({ matchType, round, status: 'completed' });

    if (completedMatches.length === 0) {
      return res.status(400).json({ error: 'No completed matches in this round' });
    }

    const winners = completedMatches
      .filter(m => m.winner && !m.isBye)
      .map(m => ({ id: m.winner, model: m.winner.equals(m.teamA) ? m.teamAModel : m.teamBModel }));

    // Add bye winners
    completedMatches.filter(m => m.isBye && m.teamA).forEach(m => {
      winners.push({ id: m.teamA, model: m.teamAModel });
    });

    const nextRound = round + 1;
    const newMatches = [];

    for (let i = 0; i < winners.length; i += 2) {
      const a = winners[i];
      const b = winners[i + 1];
      const isBye = !b;

      newMatches.push({
        matchType,
        genderGroup: completedMatches[0].genderGroup,
        round: nextRound,
        bracketPosition: Math.floor(i / 2),
        teamA: a.id,
        teamAModel: a.model,
        teamB: isBye ? null : b.id,
        teamBModel: isBye ? null : b.model,
        isBye,
        status: isBye ? 'completed' : 'upcoming',
        winner: isBye ? a.id : null,
        winnerModel: isBye ? a.model : null,
      });
    }

    await Match.insertMany(newMatches);
    res.json({ message: `Round ${nextRound} created with ${newMatches.length} matches` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE clear matches
router.delete('/clear', async (req, res) => {
  try {
    const { matchType } = req.query;
    const filter = matchType ? { matchType } : {};
    await Match.deleteMany(filter);
    if (matchType === 'double' || matchType === 'mixed') {
      await Team.deleteMany({ matchType });
    }
    res.json({ message: 'Matches cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
