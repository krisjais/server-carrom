const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  gender: { type: String, enum: ['male', 'female'], required: true },
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);
