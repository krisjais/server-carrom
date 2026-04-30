const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const Player  = require('../models/Player');
const Team    = require('../models/Team');

// ── GET /api/leaderboard?type=single|double|mixed|all ──
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

// ── GET /api/leaderboard/players — full player stats with categories ──
router.get('/players', async (req, res) => {
  try {
    const players     = await Player.find().sort({ name: 1 });
    const allMatches  = await Match.find();
    const allTeams    = await Team.find().populate('players');

    const stats = await Promise.all(players.map(async player => {
      const pid = player._id.toString();

      // ── Singles stats ──
      const singleMatches = allMatches.filter(m =>
        m.matchType === 'single' && (
          (m.teamA && m.teamA.toString() === pid) ||
          (m.teamB && m.teamB.toString() === pid)
        )
      );
      const singleDone  = singleMatches.filter(m => m.status === 'completed');
      const singleWins  = singleDone.filter(m => m.winner && m.winner.toString() === pid).length;
      const singlePts   = singleDone.reduce((s, m) =>
        s + (m.teamA?.toString() === pid ? (m.scoreA || 0) : (m.scoreB || 0)), 0);

      // ── Doubles stats (via team) ──
      const doubleTeams = allTeams.filter(t =>
        t.matchType === 'double' && t.players?.some(p => p._id.toString() === pid)
      );
      const doubleMatches = allMatches.filter(m =>
        m.matchType === 'double' && doubleTeams.some(t =>
          (m.teamA && m.teamA.toString() === t._id.toString()) ||
          (m.teamB && m.teamB.toString() === t._id.toString())
        )
      );
      const doubleDone = doubleMatches.filter(m => m.status === 'completed');
      const doubleWins = doubleDone.filter(m => {
        const winnerTeam = doubleTeams.find(t => t._id.toString() === m.winner?.toString());
        return !!winnerTeam;
      }).length;
      const doublePts = doubleDone.reduce((s, m) => {
        const myTeam = doubleTeams.find(t => t._id.toString() === m.teamA?.toString());
        return s + (myTeam ? (m.scoreA || 0) : (m.scoreB || 0));
      }, 0);

      // ── Mixed stats (via team) ──
      const mixedTeams = allTeams.filter(t =>
        t.matchType === 'mixed' && t.players?.some(p => p._id.toString() === pid)
      );
      const mixedMatches = allMatches.filter(m =>
        m.matchType === 'mixed' && mixedTeams.some(t =>
          (m.teamA && m.teamA.toString() === t._id.toString()) ||
          (m.teamB && m.teamB.toString() === t._id.toString())
        )
      );
      const mixedDone = mixedMatches.filter(m => m.status === 'completed');
      const mixedWins = mixedDone.filter(m => {
        const winnerTeam = mixedTeams.find(t => t._id.toString() === m.winner?.toString());
        return !!winnerTeam;
      }).length;
      const mixedPts = mixedDone.reduce((s, m) => {
        const myTeam = mixedTeams.find(t => t._id.toString() === m.teamA?.toString());
        return s + (myTeam ? (m.scoreA || 0) : (m.scoreB || 0));
      }, 0);

      // ── Categories played ──
      const categories = [];
      if (singleMatches.length > 0)  categories.push('single');
      if (doubleMatches.length > 0)  categories.push('double');
      if (mixedMatches.length > 0)   categories.push('mixed');

      // ── Eligibility: played all 3 = ineligible for new matches ──
      const playedAll3 = categories.length >= 3;

      // ── Overall totals ──
      const totalWins   = singleWins + doubleWins + mixedWins;
      const totalPoints = singlePts  + doublePts  + mixedPts;
      const totalPlayed = singleDone.length + doubleDone.length + mixedDone.length;
      const totalLosses = totalPlayed - totalWins;
      const winRate     = totalPlayed > 0
        ? ((totalWins / totalPlayed) * 100).toFixed(1)
        : '0.0';

      return {
        _id:    player._id,
        name:   player.name,
        gender: player.gender,

        // Category breakdown
        categories,
        playedAll3,

        // Per-category stats
        single: { played: singleDone.length, wins: singleWins, points: singlePts },
        double: { played: doubleDone.length, wins: doubleWins, points: doublePts },
        mixed:  { played: mixedDone.length,  wins: mixedWins,  points: mixedPts  },

        // Overall
        totalPlayed,
        totalWins,
        totalLosses,
        totalPoints,
        winRate,
      };
    }));

    // Sort by totalWins → winRate → totalPoints
    stats.sort((a, b) =>
      b.totalWins - a.totalWins ||
      parseFloat(b.winRate) - parseFloat(a.winRate) ||
      b.totalPoints - a.totalPoints ||
      a.name.localeCompare(b.name)
    );

    res.json(stats);
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
    const all = matches.filter(m =>
      (m.teamA && m.teamA.toString() === pid) ||
      (m.teamB && m.teamB.toString() === pid)
    );
    const done   = all.filter(m => m.status === 'completed');
    const wins   = done.filter(m => m.winner && m.winner.toString() === pid).length;
    const losses = done.length - wins;
    const pts    = done.reduce((s, m) =>
      s + (m.teamA?.toString() === pid ? (m.scoreA || 0) : (m.scoreB || 0)), 0);
    const winRate = done.length > 0 ? ((wins / done.length) * 100).toFixed(1) : '0.0';

    return { _id: player._id, name: player.name, gender: player.gender,
      matchesPlayed: done.length, wins, losses, totalPoints: pts, winRate };
  });

  const sorted = stats.sort((a, b) =>
    b.wins - a.wins || parseFloat(b.winRate) - parseFloat(a.winRate) ||
    b.totalPoints - a.totalPoints || a.name.localeCompare(b.name)
  );

  return {
    male:   sorted.filter(p => p.gender === 'male'),
    female: sorted.filter(p => p.gender === 'female'),
  };
}

// ── Team leaderboard ─────────────────────────────────
async function getTeamLeaderboard(matchType) {
  const teams   = await Team.find({ matchType }).populate('players');
  const matches = await Match.find({ matchType });

  const stats = teams.map(team => {
    const tid  = team._id.toString();
    const all  = matches.filter(m =>
      (m.teamA && m.teamA.toString() === tid) ||
      (m.teamB && m.teamB.toString() === tid)
    );
    const done   = all.filter(m => m.status === 'completed');
    const wins   = done.filter(m => m.winner && m.winner.toString() === tid).length;
    const losses = done.length - wins;
    const pts    = done.reduce((s, m) =>
      s + (m.teamA?.toString() === tid ? (m.scoreA || 0) : (m.scoreB || 0)), 0);
    const winRate = done.length > 0 ? ((wins / done.length) * 100).toFixed(1) : '0.0';

    return {
      _id: team._id,
      name: team.players?.map(p => p.name).join(' & ') || 'Unknown',
      players: team.players,
      matchType,
      matchesPlayed: done.length,
      wins, losses,
      totalPoints: pts,
      winRate,
    };
  });

  return stats.sort((a, b) =>
    b.wins - a.wins || parseFloat(b.winRate) - parseFloat(a.winRate) ||
    b.totalPoints - a.totalPoints || a.name.localeCompare(b.name)
  );
}

module.exports = router;
