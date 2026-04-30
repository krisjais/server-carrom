const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const Player  = require('../models/Player');
const Team    = require('../models/Team');

// GET /api/leaderboard?type=single|double|mixed|all
router.get('/', async (req, res) => {
  try {
    const type = req.query.type || 'single';

    if (type === 'single')  return res.json(await getSinglesLeaderboard());
    if (type === 'double')  return res.json(await getTeamLeaderboard('double'));
    if (type === 'mixed')   return res.json(await getTeamLeaderboard('mixed'));
    if (type === 'all') {
      const [singles, doubles, mixed] = await Promise.all([
        getSinglesLeaderboard(),
        getTeamLeaderboard('double'),
        getTeamLeaderboard('mixed'),
      ]);
      return res.json({ singles, doubles, mixed });
    }
    res.status(400).json({ error: 'Invalid type' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Singles leaderboard ──────────────────────────────
async function getSinglesLeaderboard() {
  const players = await Player.find().sort({ name: 1 });
  const matches = await Match.find({ matchType: 'single' });

  const stats = players.map(player => {
    const pid = player._id.toString();
    const allMatches = matches.filter(m =>
      (m.teamA && m.teamA.toString() === pid) ||
      (m.teamB && m.teamB.toString() === pid)
    );
    const completed = allMatches.filter(m => m.status === 'completed');
    const wins   = completed.filter(m => m.winner && m.winner.toString() === pid).length;
    const losses = completed.length - wins;
    const totalPoints = completed.reduce((sum, m) => {
      if (m.teamA && m.teamA.toString() === pid) return sum + (m.scoreA || 0);
      return sum + (m.scoreB || 0);
    }, 0);
    const winRate = completed.length > 0
      ? ((wins / completed.length) * 100).toFixed(1)
      : '0.0';

    return {
      _id:           player._id,
      name:          player.name,
      gender:        player.gender,
      matchesPlayed: completed.length,
      wins,
      losses,
      totalPoints,
      winRate,
    };
  });

  const sorted = stats.sort((a, b) =>
    b.wins - a.wins ||
    parseFloat(b.winRate) - parseFloat(a.winRate) ||
    b.totalPoints - a.totalPoints ||
    a.name.localeCompare(b.name)
  );

  // Return split by gender
  return {
    male:   sorted.filter(p => p.gender === 'male'),
    female: sorted.filter(p => p.gender === 'female'),
  };
}

// ── Doubles / Mixed leaderboard ──────────────────────
async function getTeamLeaderboard(matchType) {
  const teams   = await Team.find({ matchType }).populate('players');
  const matches = await Match.find({ matchType });

  const stats = teams.map(team => {
    const tid = team._id.toString();

    const allMatches = matches.filter(m =>
      (m.teamA && m.teamA.toString() === tid) ||
      (m.teamB && m.teamB.toString() === tid)
    );
    const completed = allMatches.filter(m => m.status === 'completed');
    const wins   = completed.filter(m => m.winner && m.winner.toString() === tid).length;
    const losses = completed.length - wins;

    const totalPoints = completed.reduce((sum, m) => {
      if (m.teamA && m.teamA.toString() === tid) return sum + (m.scoreA || 0);
      return sum + (m.scoreB || 0);
    }, 0);

    const winRate = completed.length > 0
      ? ((wins / completed.length) * 100).toFixed(1)
      : '0.0';

    const playerNames = team.players?.map(p => p.name).join(' & ') || 'Unknown Team';

    return {
      _id:           team._id,
      name:          playerNames,
      players:       team.players,
      matchType,
      matchesPlayed: completed.length,
      wins,
      losses,
      totalPoints,
      winRate,
    };
  });

  return stats.sort((a, b) =>
    b.wins - a.wins ||
    parseFloat(b.winRate) - parseFloat(a.winRate) ||
    b.totalPoints - a.totalPoints ||
    a.name.localeCompare(b.name)
  );
}

module.exports = router;
