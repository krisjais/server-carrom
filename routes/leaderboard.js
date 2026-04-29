const express = require('express');
const router = express.Router();
const Match = require('../models/Match');
const Player = require('../models/Player');

router.get('/', async (req, res) => {
  try {
    const players = await Player.find();
    const matches = await Match.find({ status: 'completed', matchType: 'single' });

    const stats = players.map(player => {
      const pid = player._id.toString();
      const playerMatches = matches.filter(m =>
        (m.teamA && m.teamA.toString() === pid) ||
        (m.teamB && m.teamB.toString() === pid)
      );
      const wins = playerMatches.filter(m => m.winner && m.winner.toString() === pid).length;
      const losses = playerMatches.length - wins;
      const winRate = playerMatches.length > 0 ? ((wins / playerMatches.length) * 100).toFixed(1) : '0.0';

      return {
        _id: player._id,
        name: player.name,
        gender: player.gender,
        matchesPlayed: playerMatches.length,
        wins,
        losses,
        winRate,
      };
    });

    stats.sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate) || b.wins - a.wins);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
