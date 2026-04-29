const mongoose = require('mongoose');

const matchSchema = new mongoose.Schema({
  matchType: { type: String, enum: ['single', 'double', 'mixed'], required: true },
  genderGroup: { type: String, enum: ['male', 'female', 'open'], default: 'open' },
  round: { type: Number, required: true },
  bracketPosition: { type: Number, required: true },
  teamA: { type: mongoose.Schema.Types.ObjectId, refPath: 'teamAModel' },
  teamAModel: { type: String, enum: ['Player', 'Team'] },
  teamB: { type: mongoose.Schema.Types.ObjectId, refPath: 'teamBModel' },
  teamBModel: { type: String, enum: ['Player', 'Team'] },
  scoreA: { type: Number, default: 0 },
  scoreB: { type: Number, default: 0 },
  winner: { type: mongoose.Schema.Types.ObjectId, refPath: 'winnerModel' },
  winnerModel: { type: String, enum: ['Player', 'Team'] },
  status: { type: String, enum: ['upcoming', 'live', 'completed'], default: 'upcoming' },
  isBye: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Match', matchSchema);
