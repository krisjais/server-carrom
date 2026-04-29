const Match = require('../models/Match');
const Team = require('../models/Team');
const Player = require('../models/Player');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createBracket(participants, matchType, genderGroup, entityModel) {
  const shuffled = shuffle(participants);
  const matches = [];
  let pos = 0;

  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i];
    const b = shuffled[i + 1];
    const isBye = !b;

    matches.push({
      matchType,
      genderGroup,
      round: 1,
      bracketPosition: pos++,
      teamA: a._id,
      teamAModel: entityModel,
      teamB: isBye ? null : b._id,
      teamBModel: isBye ? null : entityModel,
      isBye,
      status: isBye ? 'completed' : 'upcoming',
      winner: isBye ? a._id : null,
      winnerModel: isBye ? entityModel : null,
    });
  }

  return matches;
}

async function generateSingleMatches() {
  const males   = await Player.find({ gender: 'male' });
  const females = await Player.find({ gender: 'female' });

  const maleMatches   = createBracket(males,   'single', 'male',   'Player');
  const femaleMatches = createBracket(females, 'single', 'female', 'Player');

  await Match.insertMany([...maleMatches, ...femaleMatches]);
}

async function generateDoubleMatches() {
  const players = await Player.find();
  const shuffled = shuffle(players);

  // Pair players into teams
  const teams = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    if (!shuffled[i + 1]) break; // skip lone player
    const team = await Team.create({
      players: [shuffled[i]._id, shuffled[i + 1]._id],
      matchType: 'double',
    });
    teams.push(team);
  }

  const matches = createBracket(teams, 'double', 'open', 'Team');
  await Match.insertMany(matches);
}

async function generateMixedMatches() {
  const males   = shuffle(await Player.find({ gender: 'male' }));
  const females = shuffle(await Player.find({ gender: 'female' }));
  const count   = Math.min(males.length, females.length);

  const teams = [];
  for (let i = 0; i < count; i++) {
    const team = await Team.create({
      players: [males[i]._id, females[i]._id],
      matchType: 'mixed',
    });
    teams.push(team);
  }

  const matches = createBracket(teams, 'mixed', 'open', 'Team');
  await Match.insertMany(matches);
}

module.exports = { generateSingleMatches, generateDoubleMatches, generateMixedMatches };
