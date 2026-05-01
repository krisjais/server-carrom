const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const Team    = require('../models/Team');
const { generateSingleMatches, generateDoubleMatches, generateMixedMatches } = require('../utils/matchGenerator');

// ── Scoring Rules ────────────────────────────────────
const ICF = {
  WIN_POINTS:   25,   // first to 25 points wins the match
  WIN_BOARDS:   8,    // or first to win 8 boards
  COIN_PTS:     10,   // each opponent coin left = 10 points
  QUEEN_PTS:    50,   // queen covered = 50 points
  FOUL_PENALTY: 10,   // foul = -10 points (1 coin worth)
  TIME_BONUS:   20,   // 20 points per remaining minute when board ends
};

// Helper: check if match is won under ICF rules
function checkMatchWinner(match) {
  if (match.scoreA >= ICF.WIN_POINTS || match.boardsWonA >= ICF.WIN_BOARDS) return 'A';
  if (match.scoreB >= ICF.WIN_POINTS || match.boardsWonB >= ICF.WIN_BOARDS) return 'B';
  return null;
}

// ── GET matches ──────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { matchType } = req.query;
    const filter = matchType ? { matchType } : {};
    const matches = await Match.find(filter)
      .populate('teamA')
      .populate('teamB')
      .populate('winner')
      .sort({ round: 1, bracketPosition: 1 });

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

// ── POST generate matches ────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const { matchType } = req.body;
    if (!matchType) return res.status(400).json({ error: 'matchType is required' });

    await Match.deleteMany({ matchType });

    if (matchType === 'single')      await generateSingleMatches();
    else if (matchType === 'double') await generateDoubleMatches();
    else if (matchType === 'mixed')  await generateMixedMatches();
    else return res.status(400).json({ error: 'Invalid matchType' });

    res.json({ message: `${matchType} matches generated successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT set match live + toss ────────────────────────
router.put('/:id/live', async (req, res) => {
  try {
    const { firstStrike } = req.body;
    const match = await Match.findByIdAndUpdate(
      req.params.id,
      {
        status: 'live',
        firstStrike: firstStrike || 'A',
        startedAt: new Date(), // ← record when match went live
      },
      { new: true }
    );
    if (!match) return res.status(404).json({ error: 'Match not found' });
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT submit board result (scoring) ───────────────
// Body: { coinsPocketedA, coinsPocketedB, queenCoveredBy, foulsA, foulsB, remainingSeconds }
// coinsPocketedA = coins pocketed BY player A this board
// coinsPocketedB = coins pocketed BY player B this board
router.put('/:id/board', async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'live') return res.status(400).json({ error: 'Match is not live' });

    const {
      coinsPocketedA   = 0,   // coins pocketed BY A
      coinsPocketedB   = 0,   // coins pocketed BY B
      queenCoveredBy   = null,
      foulsA           = 0,
      foulsB           = 0,
      remainingSeconds = 0,
    } = req.body;

    // ── Scoring ──────────────────────────────────────
    // Each coin pocketed BY the player = 10 pts
    // Queen covered BY the player = 50 pts
    // Each foul = -10 pts
    // Time bonus = (remainingSeconds / 60) * 20 pts → winner only
    const timeBonus = Math.round((remainingSeconds / 60) * ICF.TIME_BONUS);

    let boardScoreA = coinsPocketedA * ICF.COIN_PTS;
    let boardScoreB = coinsPocketedB * ICF.COIN_PTS;

    if (queenCoveredBy === 'A') boardScoreA += ICF.QUEEN_PTS;
    if (queenCoveredBy === 'B') boardScoreB += ICF.QUEEN_PTS;

    // Foul penalties
    boardScoreA = Math.max(0, boardScoreA - foulsA * ICF.FOUL_PENALTY);
    boardScoreB = Math.max(0, boardScoreB - foulsB * ICF.FOUL_PENALTY);

    // Time bonus to board winner
    const boardWinnerRaw = boardScoreA > boardScoreB ? 'A' : boardScoreB > boardScoreA ? 'B' : null;
    if (boardWinnerRaw === 'A') boardScoreA += timeBonus;
    if (boardWinnerRaw === 'B') boardScoreB += timeBonus;

    const boardWinner = boardScoreA > boardScoreB ? 'A' : boardScoreB > boardScoreA ? 'B' : null;

    const boardNumber = match.boards.length + 1;
    match.boards.push({
      boardNumber,
      scoreA: boardScoreA,
      scoreB: boardScoreB,
      queenCoveredBy,
      foulsA,
      foulsB,
      boardWinner,
    });

    match.scoreA += boardScoreA;
    match.scoreB += boardScoreB;
    if (boardWinner === 'A') match.boardsWonA += 1;
    if (boardWinner === 'B') match.boardsWonB += 1;

    const matchWinner = checkMatchWinner(match);
    if (matchWinner) {
      match.status      = 'completed';
      match.winner      = matchWinner === 'A' ? match.teamA : match.teamB;
      match.winnerModel = matchWinner === 'A' ? match.teamAModel : match.teamBModel;
    }

    await match.save();
    await match.populate('teamA');
    await match.populate('teamB');
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT update match result (simple — admin override) ─
router.put('/:id/result', async (req, res) => {
  try {
    const { scoreA, scoreB, winner, status } = req.body;

    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    if (scoreA !== undefined) match.scoreA = scoreA;
    if (scoreB !== undefined) match.scoreB = scoreB;
    if (status)  match.status = status;

    if (winner) {
      match.winner = winner;
      match.winnerModel = match.teamAModel; // will be corrected below
      // Determine winnerModel from which team matches
      if (match.teamA && match.teamA.toString() === winner.toString()) {
        match.winnerModel = match.teamAModel;
      } else {
        match.winnerModel = match.teamBModel;
      }
    }

    // Auto-determine winner from ICF rules if status = completed
    if (status === 'completed' && !winner) {
      const w = checkMatchWinner(match);
      if (w) {
        match.winner      = w === 'A' ? match.teamA : match.teamB;
        match.winnerModel = w === 'A' ? match.teamAModel : match.teamBModel;
      } else {
        // Fallback: higher score wins
        if (match.scoreA > match.scoreB) {
          match.winner      = match.teamA;
          match.winnerModel = match.teamAModel;
        } else if (match.scoreB > match.scoreA) {
          match.winner      = match.teamB;
          match.winnerModel = match.teamBModel;
        }
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

// ── POST advance winners ─────────────────────────────
router.post('/advance', async (req, res) => {
  try {
    const { matchType, round } = req.body;
    const completedMatches = await Match.find({ matchType, round, status: 'completed' });

    if (completedMatches.length === 0) {
      return res.status(400).json({ error: 'No completed matches in this round' });
    }

    // Collect winners in order (rank 1, 2, 3...)
    const winnerEntries = completedMatches
      .filter(m => m.winner && !m.isBye)
      .map(m => ({
        id:    m.winner,
        model: m.winner.equals(m.teamA) ? m.teamAModel : m.teamBModel,
      }));

    completedMatches.filter(m => m.isBye && m.teamA).forEach(m => {
      winnerEntries.push({ id: m.teamA, model: m.teamAModel });
    });

    // ── Common player conflict detection (Doubles/Mixed only) ──
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

      // Check if any player appears in both rank-1 and rank-2 teams
      const rank1 = populatedWinners[0];
      const rank2 = populatedWinners[1];

      if (rank1 && rank2 && rank1.players.length && rank2.players.length) {
        const rank1Ids = rank1.players.map(p => p._id.toString());
        const commonPlayers = rank2.players.filter(p => rank1Ids.includes(p._id.toString()));

        if (commonPlayers.length > 0) {
          // There's a conflict — return conflict info instead of advancing
          // Admin must resolve by choosing a replacement from rank-3 team
          const rank3 = populatedWinners[2] || null;
          const rank3Team = rank3 ? await Team.findById(rank3.id).populate('players') : null;

          return res.status(409).json({
            conflict: true,
            message: `Common player conflict detected: ${commonPlayers.map(p => p.name).join(', ')} is in both 1st and 2nd place teams.`,
            commonPlayers: commonPlayers.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            rank1Team: {
              id: rank1.id.toString(),
              players: rank1.players.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            },
            rank2Team: {
              id: rank2.id.toString(),
              players: rank2.players.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            },
            rank3Team: rank3Team ? {
              id: rank3Team._id.toString(),
              players: rank3Team.players.map(p => ({ _id: p._id.toString(), name: p.name, gender: p.gender })),
            } : null,
            round,
            matchType,
          });
        }
      }
    }

    // No conflict — proceed normally
    const nextRound  = round + 1;
    const newMatches = [];

    for (let i = 0; i < winnerEntries.length; i += 2) {
      const a    = winnerEntries[i];
      const b    = winnerEntries[i + 1];
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
        winner:      isBye ? a.id : null,
        winnerModel: isBye ? a.model : null,
      });
    }

    await Match.insertMany(newMatches);
    res.json({ message: `Round ${nextRound} created with ${newMatches.length} matches` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST resolve common player conflict ──────────────
// When rank-1 and rank-2 teams share a player:
// - Common player stays with rank-1 team
// - rank-2 team gets a replacement player from rank-3 team
// Body: { matchType, round, rank2TeamId, removePlayerId, addPlayerId }
router.post('/resolve-conflict', async (req, res) => {
  try {
    const { matchType, round, rank2TeamId, removePlayerId, addPlayerId } = req.body;

    if (!rank2TeamId || !removePlayerId || !addPlayerId) {
      return res.status(400).json({ error: 'rank2TeamId, removePlayerId, addPlayerId are required' });
    }

    // Remove common player from rank-2 team, add replacement
    await Team.findByIdAndUpdate(rank2TeamId, {
      $pull: { players: removePlayerId },
    });
    await Team.findByIdAndUpdate(rank2TeamId, {
      $push: { players: addPlayerId },
    });

    // Now advance winners normally
    const completedMatches = await Match.find({ matchType, round, status: 'completed' });
    const winnerEntries = completedMatches
      .filter(m => m.winner && !m.isBye)
      .map(m => ({
        id:    m.winner,
        model: m.winner.equals(m.teamA) ? m.teamAModel : m.teamBModel,
      }));

    completedMatches.filter(m => m.isBye && m.teamA).forEach(m => {
      winnerEntries.push({ id: m.teamA, model: m.teamAModel });
    });

    const nextRound  = round + 1;
    const newMatches = [];

    for (let i = 0; i < winnerEntries.length; i += 2) {
      const a    = winnerEntries[i];
      const b    = winnerEntries[i + 1];
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
        winner:      isBye ? a.id : null,
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

// ── GET match rules summary ──────────────────────────
router.get('/rules', (req, res) => {
  res.json({
    title: 'ICF Official Carrom Rules (Tournament Format)',
    rules: [
      { rule: 'Board & Equipment', detail: 'Board: 74×74 cm | Striker: 41–43 mm | Coins: 9 White, 9 Black, 1 Red Queen' },
      { rule: 'Match Types',       detail: 'Singles: 1v1 | Doubles: 2v2' },
      { rule: 'Objective',         detail: 'First to 25 points OR win 8 boards' },
      { rule: 'Toss',              detail: 'Winner chooses first strike or color' },
      { rule: 'Break Shot',        detail: 'Striker from baseline to break center' },
      { rule: 'Turn Rules',        detail: 'Pocket a coin = continue | Miss = turn passes' },
      { rule: 'Queen Rules',       detail: 'Pocket queen then cover on next shot. If not covered, queen returns to center' },
      { rule: 'Fouls',             detail: 'Striker pocket, double hit, illegal touch → return 1 coin penalty' },
      { rule: 'Scoring',           detail: 'Each opponent coin left = 1 pt | Queen covered = 3 pts | Foul = -1 pt' },
      { rule: 'End of Board',      detail: 'All coins pocketed + queen covered' },
      { rule: 'Doubles',           detail: 'Alternate turns, team penalties apply' },
    ],
    winConditions: {
      points: ICF.WIN_POINTS,
      boards: ICF.WIN_BOARDS,
    },
  });
});

// ── DELETE clear matches ─────────────────────────────
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
