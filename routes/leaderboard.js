const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const Player  = require('../models/Player');
const Team    = require('../models/Team');

// ── GET /api/leaderboard?type=single|double|mixed|all ──
router.get('/', async (req, res) => {
  try {
    const type = req.query.type || 'single';

    if (type === 'single') {
      return res.json(await getSinglesLeaderboard());
    }
    if (type === 'double') {
      return res.json(await getTeamLeaderboard('double'));
    }
    if (type === 'mixed') {
      return res.json(await getTeamLeaderboard('mixed'));
    }
    if (type === 'all') {
      const [singles, doubles, mixed] = await Promise.all([
        getSinglesLeaderboard(),
        getTeamLeaderboard('double'),
        getTeamLeaderboard('mixed'),
      ]);
      return res.json({ singles, doubles, mixed });
    }

    res.status(400).json({ error: 'Invalid type. Use single, double, mixed, or all' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Singles: rank individual players ──────────────────
async function getSinglesLeaderboard() {
  const players = await Player.find();
  const matches = await Match.find({ status: 'completed', matchType: 'single' });

  const stats = players.map(player => {
    const pid = player._id.toString();
    const played = matches.filter(m =>
      (m.teamA && m.teamA.toString() === pid) ||
      (m.teamB && m.teamB.toString() === pid)
    );
    const wins   = played.filter(m => m.winner && m.winner.toString() === pid).length;
    const losses = played.length - wins;
    const totalPoints = played.reduce((sum, m) => {
      if (m.teamA && m.teamA.toString() === pid) return sum + (m.scoreA || 0);
      return sum + (m.scoreB || 0);
    }, 0);
    const winRate = played.length > 0 ? ((wins / played.length) * 100).toFixed(1) : '0.0';

    return {
      _id:           player._id,
      name:          player.name,
      gender:        player.gender,
      matchesPlayed: played.length,
      wins,
      losses,
      totalPoints,
      winRate,
    };
  });

  // Only show players who have played at least 1 match
  return stats
    .filter(p => p.matchesPlayed > 0)
    .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate) || b.wins - a.wins || b.totalPoints - a.totalPoints);
}

// ── Doubles / Mixed: rank teams ───────────────────────
async function getTeamLeaderboard(matchType) {
  const teams   = await Team.find({ matchType }).populate('players');
  const matches = await Match.find({ status: 'completed', matchType });

  const stats = teams.map(team => {
    const tid = team._id.toString();
    const played = matches.filter(m =>
      (m.teamA && m.teamA.toString() === tid) ||
      (m.teamB && m.teamB.toString() === tid)
    );
    const wins   = played.filter(m => m.winner && m.winner.toString() === tid).length;
    const losses = played.length - wins;
    const totalPoints = played.reduce((sum, m) => {
      if (m.teamA && m.teamA.toString() === tid) return sum + (m.scoreA || 0);
      return sum + (m.scoreB || 0);
    }, 0);
    const winRate = played.length > 0 ? ((wins / played.length) * 100).toFixed(1) : '0.0';

    const playerNames = team.players?.map(p => p.name).join(' & ') || 'Unknown Team';
    const genders     = team.players?.map(p => p.gender) || [];

    return {
      _id:           team._id,
      name:          playerNames,
      players:       team.players,
      genders,
      matchType,
      matchesPlayed: played.length,
      wins,
      losses,
      totalPoints,
      winRate,
    };
  });

  return stats
    .filter(t => t.matchesPlayed > 0)
    .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate) || b.wins - a.wins || b.totalPoints - a.totalPoints);
}

module.exports = router;
