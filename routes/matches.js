const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const Team    = require('../models/Team');
const {
  generateSingleMatches,
  generateDoubleMatches,
  generateMixedMatches,
} = require('../utils/matchGenerator');

// ─────────────────────────────────────────────────────
// Scoring constants
// ─────────────────────────────────────────────────────
const SCORING = {
  COIN_PTS:     10,   // points per coin pocketed by a player
  QUEEN_PTS:    50,   // bonus for covering the queen
  FOUL_PENALTY: 10,   // deducted per foul committed
  TIME_BONUS:   20,   // bonus points per whole remaining minute (winner only)
};

// Win conditions (board-based — points are for ranking only)
const WIN_BOARDS = 8;   // first to win 8 boards wins the match

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

/**
 * Calculate the score for one side in a single board.
 * Returns the raw score (before time bonus).
 */
function calcBoardScore(coinsPocketed, queenCoveredBy, side, fouls) {
  let score = coinsPocketed * SCORING.COIN_PTS;
  if (queenCoveredBy === side) score += SCORING.QUEEN_PTS;
  score -= fouls * SCORING.FOUL_PENALTY;
  return Math.max(0, score);
}

/**
 * Determine the board winner and apply the time bonus to that side.
 * Returns { scoreA, scoreB, boardWinner }.
 */
function resolveBoardScores(rawA, rawB, remainingSeconds) {
  // Time bonus: whole remaining minutes only (floor, not round)
  const timeBonus = Math.floor(remainingSeconds / 60) * SCORING.TIME_BONUS;

  // Determine winner from raw scores first
  const preWinner = rawA > rawB ? 'A' : rawB > rawA ? 'B' : null;

  // Apply time bonus to the winner
  const scoreA = rawA + (preWinner === 'A' ? timeBonus : 0);
  const scoreB = rawB + (preWinner === 'B' ? timeBonus : 0);

  // Re-evaluate winner after bonus (should be same, but be safe)
  const boardWinner = scoreA > scoreB ? 'A' : scoreB > scoreA ? 'B' : null;

  return { scoreA, scoreB, boardWinner, timeBonus };
}

/**
 * Check if the match has been won.
 * A match is won by the first side to win WIN_BOARDS boards.
 */
function checkMatchWinner(match) {
  if (match.boardsWonA >= WIN_BOARDS) return 'A';
  if (match.boardsWonB >= WIN_BOARDS) return 'B';
  return null;
}

// ─────────────────────────────────────────────────────
// GET /api/matches
// ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { matchType } = req.query;
    const filter  = matchType ? { matchType } : {};
    const matches = await Match.find(filter)
      .populate('teamA')
      .populate('teamB')
      .populate('winner')
      .sort({ round: 1, bracketPosition: 1 });

    // Populate nested team players for doubles/mixed
    const populated = await Promise.all(matches.map(async (match) => {
      const m = match.toObject();
      if (m.teamAModel === 'Team' && m.teamA) {
        m.teamA = await Team.findById(m.teamA._id || m.teamA).populate('players');
      }
      if (m.teamBModel === 'Team' && m.teamB) {
        m.teamB = await Team.findById(m.teamB._id || m.teamB).populate('players');
      }
      return m;
    }));

    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// POST /api/matches/generate
// ─────────────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const { matchType } = req.body;
    if (!matchType) return res.status(400).json({ error: 'matchType is required' });

    await Match.deleteMany({ matchType });

    if      (matchType === 'single') await generateSingleMatches();
    else if (matchType === 'double') await generateDoubleMatches();
    else if (matchType === 'mixed')  await generateMixedMatches();
    else return res.status(400).json({ error: 'Invalid matchType' });

    res.json({ message: `${matchType} matches generated successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// PUT /api/matches/:id/live  — start match + record toss
// ─────────────────────────────────────────────────────
router.put('/:id/live', async (req, res) => {
  try {
    const { firstStrike } = req.body;
    const match = await Match.findByIdAndUpdate(
      req.params.id,
      {
        status:      'live',
        firstStrike: firstStrike || 'A',
        startedAt:   new Date(),
      },
      { new: true }
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// PUT /api/matches/:id/board  — submit one board result
//
// Body:
//   coinsPocketedA   {number}  coins pocketed BY player/team A
//   coinsPocketedB   {number}  coins pocketed BY player/team B
//   queenCoveredBy   {'A'|'B'|null}
//   foulsA           {number}
//   foulsB           {number}
//   remainingSeconds {number}  seconds left on the match clock when board ended
// ─────────────────────────────────────────────────────
router.put('/:id/board', async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match)                    return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'live')   return res.status(400).json({ error: 'Match is not live' });

    const {
      coinsPocketedA   = 0,
      coinsPocketedB   = 0,
      queenCoveredBy   = null,
      foulsA           = 0,
      foulsB           = 0,
      remainingSeconds = 0,
    } = req.body;

    // 1. Raw scores (coins + queen − fouls)
    const rawA = calcBoardScore(Number(coinsPocketedA), queenCoveredBy, 'A', Number(foulsA));
    const rawB = calcBoardScore(Number(coinsPocketedB), queenCoveredBy, 'B', Number(foulsB));

    // 2. Apply time bonus to board winner
    const { scoreA, scoreB, boardWinner, timeBonus } = resolveBoardScores(
      rawA, rawB, Number(remainingSeconds)
    );

    // 3. Record board
    const boardNumber = match.boards.length + 1;
    match.boards.push({
      boardNumber,
      scoreA,
      scoreB,
      queenCoveredBy: queenCoveredBy || null,
      foulsA: Number(foulsA),
      foulsB: Number(foulsB),
      boardWinner,
    });

    // 4. Accumulate match totals
    match.scoreA    += scoreA;
    match.scoreB    += scoreB;
    if (boardWinner === 'A') match.boardsWonA += 1;
    if (boardWinner === 'B') match.boardsWonB += 1;

    // 5. Check match winner (boards-based)
    const matchWinner = checkMatchWinner(match);
    if (matchWinner) {
      match.status      = 'completed';
      match.winner      = matchWinner === 'A' ? match.teamA : match.teamB;
      match.winnerModel = matchWinner === 'A' ? match.teamAModel : match.teamBModel;
    }

    await match.save();
    await match.populate('teamA');
    await match.populate('teamB');

    res.json({
      ...match.toObject(),
      _debug: {
        board: boardNumber,
        rawA, rawB,
        timeBonus,
        scoreA, scoreB,
        boardWinner,
        boardsWonA: match.boardsWonA,
        boardsWonB: match.boardsWonB,
        matchWinner: matchWinner || 'ongoing',
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// PUT /api/matches/:id/result  — admin manual override
// ─────────────────────────────────────────────────────
router.put('/:id/result', async (req, res) => {
  try {
    const { scoreA, scoreB, winner, status } = req.body;

    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    if (scoreA !== undefined) match.scoreA = Number(scoreA);
    if (scoreB !== undefined) match.scoreB = Number(scoreB);
    if (status)               match.status = status;

    if (winner) {
      match.winner      = winner;
      match.winnerModel = (match.teamA && match.teamA.toString() === winner.toString())
        ? match.teamAModel
        : match.teamBModel;
    }

    // Auto-determine winner when marking completed without explicit winner
    if (status === 'completed' && !winner) {
      const w = checkMatchWinner(match);
      if (w) {
        match.winner      = w === 'A' ? match.teamA : match.teamB;
        match.winnerModel = w === 'A' ? match.teamAModel : match.teamBModel;
      } else if (match.scoreA > match.scoreB) {
        match.winner      = match.teamA;
        match.winnerModel = match.teamAModel;
      } else if (match.scoreB > match.scoreA) {
        match.winner      = match.teamB;
        match.winnerModel = match.teamBModel;
      }
    }

    await match.save();
    await match.populate('teamA');
    await match.populate('teamB');
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// POST /api/matches/advance  — advance round winners
// ─────────────────────────────────────────────────────
router.post('/advance', async (req, res) => {
  try {
    const { matchType, round } = req.body;
    const completedMatches = await Match.find({ matchType, round, status: 'completed' });

    if (completedMatches.length === 0) {
      return res.status(400).json({ error: 'No completed matches in this round' });
    }

    // Collect winners (non-bye matches first, then byes)
    const winnerEntries = [
      ...completedMatches
        .filter(m => m.winner && !m.isBye)
        .map(m => ({
          id:    m.winner,
          model: m.winner.equals(m.teamA) ? m.teamAModel : m.teamBModel,
        })),
      ...completedMatches
        .filter(m => m.isBye && m.teamA)
        .map(m => ({ id: m.teamA, model: m.teamAModel })),
    ];

    // Common player conflict detection (doubles/mixed only)
    if ((matchType === 'double' || matchType === 'mixed') && winnerEntries.length >= 2) {
      const populatedWinners = await Promise.all(
        winnerEntries.map(async (w, idx) => {
          if (w.model === 'Team') {
            const team = await Team.findById(w.id).populate('players');
            return { ...w, rank: idx + 1, players: team?.players || [] };
          }
          return { ...w, rank: idx + 1, players: [] };
        })
      );

      const rank1 = populatedWinners[0];
      const rank2 = populatedWinners[1];

      if (rank1?.players.length && rank2?.players.length) {
        const rank1Ids     = rank1.players.map(p => p._id.toString());
        const commonPlayers = rank2.players.filter(p => rank1Ids.includes(p._id.toString()));

        if (commonPlayers.length > 0) {
          const rank3     = populatedWinners[2] || null;
          const rank3Team = rank3 ? await Team.findById(rank3.id).populate('players') : null;

          return res.status(409).json({
            conflict: true,
            message: `Common player conflict: ${commonPlayers.map(p => p.name).join(', ')} appears in both 1st and 2nd place teams.`,
            commonPlayers: commonPlayers.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            rank1Team: {
              id:      rank1.id.toString(),
              players: rank1.players.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            },
            rank2Team: {
              id:      rank2.id.toString(),
              players: rank2.players.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            },
            rank3Team: rank3Team ? {
              id:      rank3Team._id.toString(),
              players: rank3Team.players.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            } : null,
            round,
            matchType,
          });
        }
      }
    }

    // No conflict — create next round
    const nextRound  = round + 1;
    const newMatches = [];

    for (let i = 0; i < winnerEntries.length; i += 2) {
      const a     = winnerEntries[i];
      const b     = winnerEntries[i + 1];
      const isBye = !b;

      newMatches.push({
        matchType,
        genderGroup:     completedMatches[0].genderGroup,
        round:           nextRound,
        bracketPosition: Math.floor(i / 2),
        teamA:      a.id,
        teamAModel: a.model,
        teamB:      isBye ? null : b.id,
        teamBModel: isBye ? null : b.model,
        isBye,
        status:      isBye ? 'completed' : 'upcoming',
        winner:      isBye ? a.id  : null,
        winnerModel: isBye ? a.model : null,
      });
    }

    await Match.insertMany(newMatches);
    res.json({ message: `Round ${nextRound} created with ${newMatches.length} matches` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// POST /api/matches/resolve-conflict
// ─────────────────────────────────────────────────────
router.post('/resolve-conflict', async (req, res) => {
  try {
    const { matchType, round, rank2TeamId, removePlayerId, addPlayerId } = req.body;

    if (!rank2TeamId || !removePlayerId || !addPlayerId) {
      return res.status(400).json({ error: 'rank2TeamId, removePlayerId, addPlayerId are required' });
    }

    // Swap player in rank-2 team
    await Team.findByIdAndUpdate(rank2TeamId, { $pull: { players: removePlayerId } });
    await Team.findByIdAndUpdate(rank2TeamId, { $push: { players: addPlayerId } });

    // Advance normally after conflict resolution
    const completedMatches = await Match.find({ matchType, round, status: 'completed' });
    const winnerEntries = [
      ...completedMatches
        .filter(m => m.winner && !m.isBye)
        .map(m => ({
          id:    m.winner,
          model: m.winner.equals(m.teamA) ? m.teamAModel : m.teamBModel,
        })),
      ...completedMatches
        .filter(m => m.isBye && m.teamA)
        .map(m => ({ id: m.teamA, model: m.teamAModel })),
    ];

    const nextRound  = round + 1;
    const newMatches = [];

    for (let i = 0; i < winnerEntries.length; i += 2) {
      const a     = winnerEntries[i];
      const b     = winnerEntries[i + 1];
      const isBye = !b;

      newMatches.push({
        matchType,
        genderGroup:     completedMatches[0].genderGroup,
        round:           nextRound,
        bracketPosition: Math.floor(i / 2),
        teamA:      a.id,
        teamAModel: a.model,
        teamB:      isBye ? null : b.id,
        teamBModel: isBye ? null : b.model,
        isBye,
        status:      isBye ? 'completed' : 'upcoming',
        winner:      isBye ? a.id  : null,
        winnerModel: isBye ? a.model : null,
      });
    }

    await Match.insertMany(newMatches);

    const updatedTeam = await Team.findById(rank2TeamId).populate('players');
    res.json({
      message: `Conflict resolved. Round ${nextRound} created with ${newMatches.length} matches.`,
      updatedTeam,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/matches/rules
// ─────────────────────────────────────────────────────
router.get('/rules', (_req, res) => {
  res.json({
    title: 'Carrom Tournament Scoring Rules',
    scoring: {
      coinPocketed:  `${SCORING.COIN_PTS} pts per coin pocketed`,
      queenCovered:  `${SCORING.QUEEN_PTS} pts for covering the queen`,
      foulPenalty:   `−${SCORING.FOUL_PENALTY} pts per foul`,
      timeBonus:     `+${SCORING.TIME_BONUS} pts per whole remaining minute (board winner only)`,
    },
    winCondition: `First to win ${WIN_BOARDS} boards wins the match`,
    notes: [
      'Points accumulate across boards for ranking/tiebreaking purposes.',
      'Time bonus uses floor(remainingSeconds / 60) — partial minutes do not count.',
      'Board winner is determined from raw score (before time bonus) to avoid circular dependency.',
    ],
  });
});

// ─────────────────────────────────────────────────────
// DELETE /api/matches/clear
// ─────────────────────────────────────────────────────
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
