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

    // ── Check eligibility: max 3 total matches ──
    const Team  = require('../models/Team');
    const Match = require('../models/Match');

    for (const player of players) {
      const pid      = player._id.toString();
      const myTeams  = await Team.find({ players: pid });
      const teamIds  = myTeams.map(t => t._id.toString());
      const singles  = await Match.countDocuments({ matchType: 'single', $or: [{ teamA: pid }, { teamB: pid }] });
      const doubles  = await Match.countDocuments({ matchType: 'double', $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }] });
      const mixed    = await Match.countDocuments({ matchType: 'mixed',  $or: [{ teamA: { $in: teamIds } }, { teamB: { $in: teamIds } }] });
      const total    = singles + doubles + mixed;

      if (total >= 3) {
        return res.status(400).json({
          error: `${player.name} has already played ${total} matches and is ineligible for new matches.`,
        });
      }
    }

    // Validate mixed: must be 1 male + 1 female
    if (matchType === 'mixed') {
      const genders = players.map(p => p.gender);
      if (!genders.includes('male') || !genders.includes('female')) {
        return res.status(400).json({ error: 'Mixed doubles team must have 1 Male and 1 Female player' });
      }
    }

    // Check if either player is already in a team for this matchType
    // NOTE: A player CAN be in multiple teams (reshuffling is allowed)
    // We only block if they are already in a team AND that team has played matches
    const existingTeam = await Team.findOne({ matchType, players: { $in: playerIds } });
    if (existingTeam) {
      // Check if this team has already played any matches
      const teamMatchCount = await Match.countDocuments({
        matchType,
        $or: [{ teamA: existingTeam._id }, { teamB: existingTeam._id }],
      });
      if (teamMatchCount > 0) {
        const player = await Player.findById(
          playerIds.find(id => existingTeam.players.map(p => p.toString()).includes(id.toString()))
        );
        return res.status(400).json({
          error: `${player?.name || 'A player'} is already in an active team for this category. Use the reshuffle feature to swap players.`,
        });
      }
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

// POST reshuffle — swap a player between two teams
// Body: { teamAId, teamBId, playerFromA, playerFromB }
// Swaps playerFromA (currently in teamA) with playerFromB (currently in teamB)
router.post('/reshuffle', async (req, res) => {
  try {
    const { teamAId, teamBId, playerFromA, playerFromB } = req.body;

    if (!teamAId || !teamBId || !playerFromA || !playerFromB) {
      return res.status(400).json({ error: 'teamAId, teamBId, playerFromA, playerFromB are all required' });
    }

    const teamA = await Team.findById(teamAId).populate('players');
    const teamB = await Team.findById(teamBId).populate('players');

    if (!teamA || !teamB) return res.status(404).json({ error: 'One or both teams not found' });
    if (teamA.matchType !== teamB.matchType) {
      return res.status(400).json({ error: 'Teams must be in the same match category' });
    }

    // Verify players are in the correct teams
    const aHasPlayer = teamA.players.some(p => p._id.toString() === playerFromA);
    const bHasPlayer = teamB.players.some(p => p._id.toString() === playerFromB);

    if (!aHasPlayer) return res.status(400).json({ error: 'playerFromA is not in teamA' });
    if (!bHasPlayer) return res.status(400).json({ error: 'playerFromB is not in teamB' });

    // Validate mixed doubles constraint after swap
    if (teamA.matchType === 'mixed') {
      const Player = require('../models/Player');
      const newTeamAPlayers = [
        ...teamA.players.filter(p => p._id.toString() !== playerFromA).map(p => p._id),
        playerFromB,
      ];
      const newTeamBPlayers = [
        ...teamB.players.filter(p => p._id.toString() !== playerFromB).map(p => p._id),
        playerFromA,
      ];
      const [pA, pB] = await Promise.all([
        Player.find({ _id: { $in: newTeamAPlayers } }),
        Player.find({ _id: { $in: newTeamBPlayers } }),
      ]);
      const checkMixed = (players) => {
        const genders = players.map(p => p.gender);
        return genders.includes('male') && genders.includes('female');
      };
      if (!checkMixed(pA) || !checkMixed(pB)) {
        return res.status(400).json({ error: 'Swap would violate Mixed Doubles rule: each team must have 1 Male + 1 Female' });
      }
    }

    // Perform the swap
    await Team.findByIdAndUpdate(teamAId, {
      $pull: { players: playerFromA },
    });
    await Team.findByIdAndUpdate(teamAId, {
      $push: { players: playerFromB },
    });
    await Team.findByIdAndUpdate(teamBId, {
      $pull: { players: playerFromB },
    });
    await Team.findByIdAndUpdate(teamBId, {
      $push: { players: playerFromA },
    });

    const [updatedA, updatedB] = await Promise.all([
      Team.findById(teamAId).populate('players'),
      Team.findById(teamBId).populate('players'),
    ]);

    res.json({
      message: 'Players swapped successfully',
      teamA: updatedA,
      teamB: updatedB,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
