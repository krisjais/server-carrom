const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
  players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Player' }],
  matchType: { type: String, enum: ['double', 'mixed'], required: true },
}, { timestamps: true });

module.exports = mongoose.model('Team', teamSchema);
