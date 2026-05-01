const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const Player  = require('../models/Player');
const Team    = require('../models/Team');

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

/**
 * Given a list of completed matches and an entity ID (player or team),
 * return { played, wins, losses, points }.
 * sideField: 'teamA' | 'teamB' — which field holds this entity's ID.
 */
function calcStats(completedMatches, entityId) {
  const id = entityId.toString();

  const relevant = completedMatches.filter(m =>
    (m.teamA && m.teamA.toString() === id) ||
    (m.teamB && m.teamB.toString() === id)
  );

  const wins   = relevant.filter(m => m.winner && m.winner.toString() === id).length;
  const losses = relevant.length - wins;

  const points = relevant.reduce((sum, m) => {
    const isA = m.teamA && m.teamA.toString() === id;
    return sum + (isA ? (m.scoreA || 0) : (m.scoreB || 0));
  }, 0);

  const winRate = relevant.length > 0
    ? ((wins / relevant.length) * 100).toFixed(1)
    : '0.0';

  return { played: relevant.length, wins, losses, points, winRate };
}

// ─────────────────────────────────────────────────────
// GET /api/leaderboard?type=single|double|mixed|all
// ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const type = req.query.type || 'single';

    if (type === 'single') return res.json(await getSinglesLeaderboard());
    if (type === 'double') return res.json(await getTeamLeaderboard('double'));
    if (type === 'mixed')  return res.json(await getTeamLeaderboard('mixed'));

    if (type === 'all') {
      const [singles, doubles, mixed] = await Promise.all([
        getSinglesLeaderboard(),
        getTeamLeaderboard('double'),
        getTeamLeaderboard('mixed'),
      ]);
      return res.json({ singles, doubles, mixed });
    }

    res.status(400).json({ error: 'Invalid type. Use single | double | mixed | all' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/leaderboard/players — full per-player stats
// ─────────────────────────────────────────────────────
router.get('/players', async (req, res) => {
  try {
    const [players, allMatches, allTeams] = await Promise.all([
      Player.find().sort({ name: 1 }),
      Match.find({ status: 'completed' }),   // only completed matches count
      Team.find().populate('players'),
    ]);

    const stats = players.map(player => {
      const pid = player._id.toString();

      // ── Singles ──────────────────────────────────
      const singleMatches = allMatches.filter(m =>
        m.matchType === 'single' && (
          (m.teamA && m.teamA.toString() === pid) ||
          (m.teamB && m.teamB.toString() === pid)
        )
      );
      const singleStats = calcStats(singleMatches, pid);

      // ── Doubles ──────────────────────────────────
      const doubleTeams = allTeams.filter(t =>
        t.matchType === 'double' &&
        t.players?.some(p => p._id.toString() === pid)
      );
      const doubleMatches = allMatches.filter(m =>
        m.matchType === 'double' &&
        doubleTeams.some(t =>
          (m.teamA && m.teamA.toString() === t._id.toString()) ||
          (m.teamB && m.teamB.toString() === t._id.toString())
        )
      );
      // For doubles, wins/points are attributed to the team, not the player directly
      const doubleStats = doubleTeams.length > 0
        ? calcStatsForTeams(doubleMatches, doubleTeams)
        : { played: 0, wins: 0, losses: 0, points: 0, winRate: '0.0' };

      // ── Mixed ─────────────────────────────────────
      const mixedTeams = allTeams.filter(t =>
        t.matchType === 'mixed' &&
        t.players?.some(p => p._id.toString() === pid)
      );
      const mixedMatches = allMatches.filter(m =>
        m.matchType === 'mixed' &&
        mixedTeams.some(t =>
          (m.teamA && m.teamA.toString() === t._id.toString()) ||
          (m.teamB && m.teamB.toString() === t._id.toString())
        )
      );
      const mixedStats = mixedTeams.length > 0
        ? calcStatsForTeams(mixedMatches, mixedTeams)
        : { played: 0, wins: 0, losses: 0, points: 0, winRate: '0.0' };

      // ── Totals ────────────────────────────────────
      const totalPlayed = singleStats.played + doubleStats.played + mixedStats.played;
      const totalWins   = singleStats.wins   + doubleStats.wins   + mixedStats.wins;
      const totalLosses = singleStats.losses + doubleStats.losses + mixedStats.losses;
      const totalPoints = singleStats.points + doubleStats.points + mixedStats.points;
      const winRate     = totalPlayed > 0
        ? ((totalWins / totalPlayed) * 100).toFixed(1)
        : '0.0';

      // Categories this player has participated in
      const categories = [
        singleMatches.length > 0 ? 'single' : null,
        doubleMatches.length > 0 ? 'double' : null,
        mixedMatches.length  > 0 ? 'mixed'  : null,
      ].filter(Boolean);

      return {
        _id:    player._id,
        name:   player.name,
        gender: player.gender,

        categories,
        eligible: categories.length < 3,   // ineligible once played all 3

        single: singleStats,
        double: doubleStats,
        mixed:  mixedStats,

        totalPlayed,
        totalWins,
        totalLosses,
        totalPoints,
        winRate,
      };
    });

    // Sort: wins → winRate → points → name
    stats.sort((a, b) =>
      b.totalWins   - a.totalWins   ||
      parseFloat(b.winRate) - parseFloat(a.winRate) ||
      b.totalPoints - a.totalPoints ||
      a.name.localeCompare(b.name)
    );

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// Singles leaderboard (grouped by gender)
// ─────────────────────────────────────────────────────
async function getSinglesLeaderboard() {
  const [players, allMatches, allTeams] = await Promise.all([
    Player.find().sort({ name: 1 }),
    Match.find({ matchType: 'single', status: 'completed' }),
    Team.find(),
  ]);

  const stats = await Promise.all(players.map(async player => {
    const pid = player._id.toString();

    const { played, wins, losses, points, winRate } = calcStats(allMatches, pid);

    // Eligibility: count all match types this player has been in
    const myTeams  = allTeams.filter(t => t.players?.some(p => p.toString() === pid));
    const teamIds  = myTeams.map(t => t._id.toString());
    const allForPlayer = await Match.find({
      $or: [
        { matchType: 'single', $or: [{ teamA: pid }, { teamB: pid }] },
        {
          matchType: { $in: ['double', 'mixed'] },
          $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }],
        },
      ],
    });
    const categories      = [...new Set(allForPlayer.map(m => m.matchType))];
    const totalMatchCount = allForPlayer.length;

    return {
      _id:    player._id,
      name:   player.name,
      gender: player.gender,
      matchesPlayed: played,
      wins,
      losses,
      totalPoints: points,
      winRate,
      categories,
      totalMatchCount,
      eligible: totalMatchCount < 3,
    };
  }));

  const sorted = stats.sort((a, b) =>
    b.wins   - a.wins   ||
    parseFloat(b.winRate) - parseFloat(a.winRate) ||
    b.totalPoints - a.totalPoints ||
    a.name.localeCompare(b.name)
  );

  return {
    male:   sorted.filter(p => p.gender === 'male'),
    female: sorted.filter(p => p.gender === 'female'),
  };
}

// ─────────────────────────────────────────────────────
// Team leaderboard (doubles or mixed)
// ─────────────────────────────────────────────────────
async function getTeamLeaderboard(matchType) {
  const [teams, matches] = await Promise.all([
    Team.find({ matchType }).populate('players'),
    Match.find({ matchType, status: 'completed' }),
  ]);

  const stats = teams.map(team => {
    const { played, wins, losses, points, winRate } = calcStats(matches, team._id);

    return {
      _id:           team._id,
      name:          team.players?.map(p => p.name).join(' & ') || 'Unknown',
      players:       team.players,
      matchType,
      matchesPlayed: played,
      wins,
      losses,
      totalPoints:   points,
      winRate,
    };
  });

  return stats.sort((a, b) =>
    b.wins   - a.wins   ||
    parseFloat(b.winRate) - parseFloat(a.winRate) ||
    b.totalPoints - a.totalPoints ||
    a.name.localeCompare(b.name)
  );
}

// ─────────────────────────────────────────────────────
// Helper: aggregate stats across multiple teams for one player
// (used when a player is on a team in doubles/mixed)
// ─────────────────────────────────────────────────────
function calcStatsForTeams(completedMatches, teams) {
  let played = 0, wins = 0, losses = 0, points = 0;

  for (const team of teams) {
    const s = calcStats(completedMatches, team._id);
    played += s.played;
    wins   += s.wins;
    losses += s.losses;
    points += s.points;
  }

  const winRate = played > 0 ? ((wins / played) * 100).toFixed(1) : '0.0';
  return { played, wins, losses, points, winRate };
}

module.exports = router;
