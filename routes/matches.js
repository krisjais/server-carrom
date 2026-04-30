const express = require('express');
const router  = express.Router();
const Match   = require('../models/Match');
const Team    = require('../models/Team');
const { generateSingleMatches, generateDoubleMatches, generateMixedMatches } = require('../utils/matchGenerator');

// ── ICF Rules Constants ──────────────────────────────
const ICF = {
  WIN_POINTS:  25,   // first to 25 points wins the match
  WIN_BOARDS:  8,    // or first to win 8 boards
  QUEEN_PTS:   3,    // queen = 3 points if covered
  COIN_PTS:    1,    // each opponent coin left = 1 point
  FOUL_PENALTY: 1,   // foul = return 1 coin (deduct 1 point from scorer)
  TOTAL_COINS: 19,   // 9 white + 9 black + 1 queen
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

// ── PUT submit board result (ICF scoring) ───────────
// Body: { coinsLeftA, coinsLeftB, queenCoveredBy, foulsA, foulsB }
// coinsLeftA = opponent A's coins still on board (scored by B)
// coinsLeftB = opponent B's coins still on board (scored by A)
router.put('/:id/board', async (req, res) => {
  try {
    const match = await Match.findById(req.params.id);
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'live') return res.status(400).json({ error: 'Match is not live' });

    const {
      coinsLeftA = 0,   // A's coins left on board (B scores these)
      coinsLeftB = 0,   // B's coins left on board (A scores these)
      queenCoveredBy = null,  // 'A', 'B', or null
      foulsA = 0,
      foulsB = 0,
    } = req.body;

    // ICF Scoring for this board:
    // A scores: B's remaining coins + queen (if A covered) - A's foul penalties
    let boardScoreA = coinsLeftB * ICF.COIN_PTS;
    let boardScoreB = coinsLeftA * ICF.COIN_PTS;

    if (queenCoveredBy === 'A') boardScoreA += ICF.QUEEN_PTS;
    if (queenCoveredBy === 'B') boardScoreB += ICF.QUEEN_PTS;

    // Foul penalties: each foul = return 1 coin = -1 point
    boardScoreA = Math.max(0, boardScoreA - foulsA * ICF.FOUL_PENALTY);
    boardScoreB = Math.max(0, boardScoreB - foulsB * ICF.FOUL_PENALTY);

    // Determine board winner
    const boardWinner = boardScoreA > boardScoreB ? 'A' : boardScoreB > boardScoreA ? 'B' : null;

    // Record this board
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

    // Update cumulative match scores
    match.scoreA += boardScoreA;
    match.scoreB += boardScoreB;
    if (boardWinner === 'A') match.boardsWonA += 1;
    if (boardWinner === 'B') match.boardsWonB += 1;

    // Check ICF win condition
    const matchWinner = checkMatchWinner(match);
    if (matchWinner) {
      match.status = 'completed';
      match.winner      = matchWinner === 'A' ? match.teamA : match.teamB;
      match.winnerModel = matchWinner === 'A' ? match.teamAModel : match.teamBModel;
    }

    await match.save();

    // Populate and return
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

    const winners = completedMatches
      .filter(m => m.winner && !m.isBye)
      .map(m => ({
        id:    m.winner,
        model: m.winner.equals(m.teamA) ? m.teamAModel : m.teamBModel,
      }));

    completedMatches.filter(m => m.isBye && m.teamA).forEach(m => {
      winners.push({ id: m.teamA, model: m.teamAModel });
    });

    const nextRound  = round + 1;
    const newMatches = [];

    for (let i = 0; i < winners.length; i += 2) {
      const a    = winners[i];
      const b    = winners[i + 1];
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
