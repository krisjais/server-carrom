/**
 * Seed script — adds all registered players from the event form
 * Run: node backend/scripts/seedPlayers.js
 *
 * Categories from registration:
 *   Singles, Doubles, Mix Doubles (male+female)
 *
 * Deduplication: Mudassir Markania registered 3 times — merged into one entry
 * Siddhi Ghanekar registered twice — merged
 * Anjali Yadav registered twice — merged
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Player   = require('../models/Player');

// ── Cleaned player list from registration form ──────────────────────────────
// gender determined by name / context
// categories: which rounds they registered for
const PLAYERS = [
  {
    name:       'Nouman Khan',
    gender:     'male',
    department: 'Ex Interns',
    categories: ['single', 'double', 'double'], // R1: Singles, R2: Doubles, R3: Doubles
    note:       'Doubles partner: Aquib Hingwala (both rounds)',
  },
  {
    name:       'Sayyed Yaseen',
    gender:     'male',
    department: 'B.VOC',
    categories: ['single', 'single', 'single'],
    note:       'Singles all 3 rounds',
  },
  {
    name:       'Sufiyan Khan',
    gender:     'male',
    department: 'Marketing Junction',
    categories: ['single', 'single', 'mixed'],
    note:       'R3 Mixed partner: Tasmiya Shaikh',
  },
  {
    name:       'Mohammed Qutbuddin Kotkunde',
    gender:     'male',
    department: 'Marketing Junction',
    categories: ['single', 'double', 'mixed', 'single', 'double', 'mixed'],
    note:       'All 3 categories in all 3 rounds',
  },
  {
    name:       'Anjali Yadav',
    gender:     'female',
    department: 'HR Department',
    categories: ['single', 'double', 'mixed'],
    note:       'R2 Doubles: Siddhi Ghanekar, R3 Mixed: Pravin Chettiar',
  },
  {
    name:       'Abhijeet Sawant',
    gender:     'male',
    department: 'IT Department',
    categories: ['double', 'double', 'double'],
    note:       'Doubles partner: Vinayak Gupta all rounds',
  },
  {
    name:       'Siddhi Ghanekar',
    gender:     'female',
    department: 'HR Department',
    categories: ['mixed', 'double', 'mixed'],
    note:       'R1 Mixed: Shams Ali, R2 Doubles: Anjali, R3 Mixed: Shams Ali',
  },
  {
    name:       'Shweta Kedare',
    gender:     'female',
    department: 'IT Department',
    categories: ['mixed', 'mixed', 'mixed'],
    note:       'Mixed partner: Abhijeet Sawant all rounds',
  },
  {
    name:       'Mudassir Markania',
    gender:     'male',
    department: 'IT Department',
    categories: ['single', 'single', 'single', 'double', 'double', 'double', 'mixed', 'mixed', 'mixed'],
    note:       'Singles + Doubles (Ashwin Singh) + Mixed (Samruddhi Mhapralkar)',
  },
  {
    name:       'Pravin Chettiar',
    gender:     'male',
    department: 'B.VOC',
    categories: ['single', 'double', 'single', 'mixed'],
    note:       'R1: Singles+Doubles(Sanskar), R2: Singles, R3: Mixed(Siddhi)',
  },
  {
    name:       'Owais Chipa',
    gender:     'male',
    department: 'Ex Interns',
    categories: ['single', 'double', 'mixed', 'single', 'double', 'single', 'double'],
    note:       'All categories across rounds, Doubles partner: Sufyan/Tasmiya',
  },
  {
    name:       'Sanskar Ashan',
    gender:     'male',
    department: 'B.VOC',
    categories: ['double', 'double', 'double'],
    note:       'Doubles partner: Piyush Patwa all rounds',
  },
  {
    name:       'Ashutosh Goswami',
    gender:     'male',
    department: 'IT Department',
    categories: ['single', 'single', 'single'],
    note:       'Singles all 3 rounds',
  },
  {
    name:       'Saeed Siddiqui',
    gender:     'male',
    department: 'Faculty',
    categories: ['double', 'double', 'double'],
    note:       'Doubles: R1 Qutubuddin, R2 Sufiyan, R3 Shamsh',
  },
  {
    name:       'Faiz Ahmed Shaikh',
    gender:     'male',
    department: 'B.VOC',
    categories: ['double', 'double', 'single'],
    note:       'R1+R2 Doubles: Affan Khan, R3 Singles',
  },
  {
    name:       'Affan Khan',
    gender:     'male',
    department: 'B.VOC',
    categories: ['single', 'double', 'double'],
    note:       'R1 Singles, R2+R3 Doubles: Faiz',
  },
  {
    name:       'Tasmiya Shaikh',
    gender:     'female',
    department: 'Marketing Junction',
    categories: ['mixed'],
    note:       'Mixed partner: Sufiyan Khan (R3)',
  },
  {
    name:       'Aquib Hingwala',
    gender:     'male',
    department: 'Ex Interns',
    categories: ['double', 'double'],
    note:       'Doubles partner: Nouman Khan (R2+R3)',
  },
  {
    name:       'Vinayak Gupta',
    gender:     'male',
    department: 'IT Department',
    categories: ['double', 'double', 'double'],
    note:       'Doubles partner: Abhijeet Sawant all rounds',
  },
  {
    name:       'Ashwin Singh',
    gender:     'male',
    department: 'IT Department',
    categories: ['double', 'double', 'double'],
    note:       'Doubles partner: Mudassir Markania all rounds',
  },
  {
    name:       'Samruddhi Mhapralkar',
    gender:     'female',
    department: 'IT Department',
    categories: ['mixed', 'mixed', 'mixed'],
    note:       'Mixed partner: Mudassir Markania all rounds',
  },
  {
    name:       'Piyush Patwa',
    gender:     'male',
    department: 'B.VOC',
    categories: ['double', 'double', 'double'],
    note:       'Doubles partner: Sanskar Ashan all rounds',
  },
  {
    name:       'Shams Ali Shaikh',
    gender:     'male',
    department: 'Unknown',
    categories: ['mixed'],
    note:       'Mixed partner: Siddhi Ghanekar',
  },
  {
    name:       'Zaid Achhwa',
    gender:     'male',
    department: 'Unknown',
    categories: ['double'],
    note:       'Doubles partner: Anjali Yadav (R2)',
  },
  {
    name:       'Farhan Tolkar',
    gender:     'male',
    department: 'B.VOC',
    categories: ['double'],
    note:       'Doubles partner: Faiz Ahmed (R2)',
  },
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/carrom_tournament');
    console.log('✅ Connected to MongoDB\n');

    let added = 0;
    let skipped = 0;

    for (const p of PLAYERS) {
      // Check if player already exists (by name, case-insensitive)
      const exists = await Player.findOne({ name: { $regex: new RegExp(`^${p.name}$`, 'i') } });
      if (exists) {
        console.log(`⏭  Skipped (exists): ${p.name}`);
        skipped++;
        continue;
      }

      await Player.create({ name: p.name, gender: p.gender });
      const cats = [...new Set(p.categories)].join(', ');
      console.log(`✅ Added: ${p.name} (${p.gender}) — ${p.department} — Categories: ${cats}`);
      added++;
    }

    console.log(`\n📊 Summary: ${added} added, ${skipped} skipped (already exist)`);
    console.log('\n📋 Category breakdown:');
    console.log('   Singles players:', PLAYERS.filter(p => p.categories.includes('single')).map(p => p.name).join(', '));
    console.log('   Doubles players:', PLAYERS.filter(p => p.categories.includes('double')).map(p => p.name).join(', '));
    console.log('   Mixed players:  ', PLAYERS.filter(p => p.categories.includes('mixed')).map(p => p.name).join(', '));

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

seed();
