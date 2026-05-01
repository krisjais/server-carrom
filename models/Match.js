const mongoose = require('mongoose');

// ICF Rules: Each board tracks coins pocketed, queen status, fouls
const boardSchema = new mongoose.Schema({
  boardNumber:   { type: Number, required: true },
  scoreA:        { type: Number, default: 0 },  // points scored by A in this board
  scoreB:        { type: Number, default: 0 },  // points scored by B in this board
  queenCoveredBy:{ type: String, enum: ['A', 'B', null], default: null }, // who covered the queen
  foulsA:        { type: Number, default: 0 },
  foulsB:        { type: Number, default: 0 },
  boardWinner:   { type: String, enum: ['A', 'B', null], default: null },
}, { _id: false });

const matchSchema = new mongoose.Schema({
  matchType:  { type: String, enum: ['single', 'double', 'mixed'], required: true },
  genderGroup:{ type: String, enum: ['male', 'female', 'open'], default: 'open' },
  round:      { type: Number, required: true },
  bracketPosition: { type: Number, required: true },

  teamA:      { type: mongoose.Schema.Types.ObjectId, refPath: 'teamAModel' },
  teamAModel: { type: String, enum: ['Player', 'Team'] },
  teamB:      { type: mongoose.Schema.Types.ObjectId, refPath: 'teamBModel' },
  teamBModel: { type: String, enum: ['Player', 'Team'] },

  // ICF scoring: total points across all boards
  scoreA: { type: Number, default: 0 },  // total match points for A
  scoreB: { type: Number, default: 0 },  // total match points for B

  // ICF win conditions
  boardsWonA: { type: Number, default: 0 },  // boards won by A
  boardsWonB: { type: Number, default: 0 },  // boards won by B

  // Board-by-board history
  boards: { type: [boardSchema], default: [] },

  winner:      { type: mongoose.Schema.Types.ObjectId, refPath: 'winnerModel' },
  winnerModel: { type: String, enum: ['Player', 'Team'] },
  status:      { type: String, enum: ['upcoming', 'live', 'completed'], default: 'upcoming' },
  isBye:       { type: Boolean, default: false },

  // ICF: who strikes first (toss winner)
  firstStrike: { type: String, enum: ['A', 'B', null], default: null },
  // Timer: when match went live
  startedAt: { type: Date, default: null },
  // Timer: when the current board started (resets after each board submission)
  boardStartedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Match', matchSchema);
