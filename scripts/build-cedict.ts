import fs from 'fs';
import path from 'path';
import https from 'https';
import zlib from 'zlib';

const DICT_DIR = path.resolve(process.cwd(), 'public/dict');
const OUTPUT_FILE = path.resolve(DICT_DIR, 'cedict.json');

// Essential fallback vocabulary with comprehensive common characters and HSK 1-6 words
const ESSENTIAL_DICT: Record<string, { pinyin: string; definitions: string[] }> = {
  // Characters for breakdowns & core words
  '落': { pinyin: 'luò', definitions: ['to fall', 'to drop', 'to alight'] },
  '实': { pinyin: 'shí', definitions: ['solid', 'real', 'true', 'fruit'] },
  '落实': { pinyin: 'luò shí', definitions: ['to implement', 'to carry out', 'to put into practice'] },
  '效': { pinyin: 'xiào', definitions: ['effect', 'efficacy', 'to imitate'] },
  '率': { pinyin: 'lǜ', definitions: ['rate', 'frequency', 'ratio'] },
  '效率': { pinyin: 'xiào lǜ', definitions: ['efficiency'] },
  '背': { pinyin: 'bèi', definitions: ['back of body', 'to turn one\'s back'] },
  '影': { pinyin: 'yǐng', definitions: ['shadow', 'image', 'picture'] },
  '背影': { pinyin: 'bèi yǐng', definitions: ['view of somebody\'s back', 'silhouette of back'] },
  '交': { pinyin: 'jiāo', definitions: ['to hand over', 'to deliver', 'to intersect'] },
  '卸': { pinyin: 'xiè', definitions: ['to unload', 'to remove', 'to strip off'] },
  '交卸': { pinyin: 'jiāo xiè', definitions: ['to hand over to a successor', 'to resign office'] },
  '差': { pinyin: 'chāi', definitions: ['official errand', 'dispatch'] },
  '使': { pinyin: 'shǐ', definitions: ['to send', 'to cause', 'envoy'] },
  '差使': { pinyin: 'chāi shi', definitions: ['official post', 'errand', 'assignment'] },
  '狼': { pinyin: 'láng', definitions: ['wolf'] },
  '藉': { pinyin: 'jí', definitions: ['in disorder', 'mess'] },
  '狼藉': { pinyin: 'láng jí', definitions: ['in complete disorder', 'in a mess'] },
  '簌': { pinyin: 'sù', definitions: ['rustle', 'tearful'] },
  '簌簌': { pinyin: 'sù sù', definitions: ['(tears) streaming down', 'rustling'] },
  '典': { pinyin: 'diǎn', definitions: ['pawn', 'statute', 'ceremony'] },
  '质': { pinyin: 'zhì', definitions: ['pawn', 'pledge', 'substance', 'quality'] },
  '典质': { pinyin: 'diǎn zhì', definitions: ['to pawn', 'to mortgage'] },
  '亏': { pinyin: 'kuī', definitions: ['deficiency', 'deficit', 'to lose'] },
  '空': { pinyin: 'kōng', definitions: ['empty', 'hollow', 'deficit'] },
  '亏空': { pinyin: 'kuī kong', definitions: ['debt', 'deficit'] },
  '赋': { pinyin: 'fù', definitions: ['to pay tax', 'to be endowed with'] },
  '闲': { pinyin: 'xián', definitions: ['idle', 'unoccupied'] },
  '赋闲': { pinyin: 'fù xián', definitions: ['to be unemployed', 'to stay idle at home'] },
  '勾': { pinyin: 'gōu', definitions: ['to hook', 'to delineate', 'to stay'] },
  '留': { pinyin: 'liú', definitions: ['to remain', 'to stay'] },
  '勾留': { pinyin: 'gōu liú', definitions: ['to stop over', 'to stay'] },
  '踌': { pinyin: 'chóu', definitions: ['to hesitate', 'hesitant'] },
  '躇': { pinyin: 'chú', definitions: ['to hesitate'] },
  '踌躇': { pinyin: 'chóu chú', definitions: ['to hesitate', 'to waver'] },
  '茶': { pinyin: 'chá', definitions: ['tea'] },
  '房': { pinyin: 'fáng', definitions: ['room', 'house'] },
  '茶房': { pinyin: 'chá fang', definitions: ['waiter (archaic)', 'steward'] },
  '脚': { pinyin: 'jiǎo', definitions: ['foot', 'leg'] },
  '夫': { pinyin: 'fū', definitions: ['man', 'husband', 'porter'] },
  '脚夫': { pinyin: 'jiǎo fū', definitions: ['porter', 'bearer'] },
  '迂': { pinyin: 'yū', definitions: ['pedantic', 'stubborn', 'roundabout'] },
  '料': { pinyin: 'liào', definitions: ['material', 'to manage', 'to expect'] },
  '理': { pinyin: 'lǐ', definitions: ['reason', 'logic', 'to arrange', 'to manage'] },
  '料理': { pinyin: 'liào lǐ', definitions: ['to manage', 'to take care of'] },
  '警': { pinyin: 'jǐng', definitions: ['alert', 'warn', 'police'] },
  '醒': { pinyin: 'xǐng', definitions: ['wake up', 'sober up', 'alert'] },
  '警醒': { pinyin: 'jǐng xǐng', definitions: ['alert', 'vigilant', 'to wake easily'] },
  '照': { pinyin: 'zhào', definitions: ['shine', 'reflect', 'take care'] },
  '应': { pinyin: 'yìng', definitions: ['respond', 'answer', 'cope'] },
  '照应': { pinyin: 'zhào yìng', definitions: ['to look after', 'to take care of', 'to coordinate'] },
  '祸': { pinyin: 'huò', definitions: ['misfortune', 'calamity'] },
  '单': { pinyin: 'dān', definitions: ['single', 'lone'] },
  '行': { pinyin: 'xíng', definitions: ['to walk', 'to travel', 'to act'] },
  '祸不单行': { pinyin: 'huò bù dān xíng', definitions: ['misfortunes never come singly (idiom)'] },
  '惨': { pinyin: 'cǎn', definitions: ['miserable', 'tragic'] },
  '淡': { pinyin: 'dàn', definitions: ['pale', 'insipid', 'dim'] },
  '惨淡': { pinyin: 'cǎn dàn', definitions: ['dark', 'gloomy', 'dismal'] },
};

function isMetadataSense(sense: string): boolean {
  const s = sense.trim();
  if (/^CL:/i.test(s)) return true;
  if (/^(?:also\s+|Taiwan\s+|mainland\s+)?pr\.\s*\[/i.test(s)) return true;
  return false;
}

function parseCedictLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  // CC-CEDICT format:
  // Traditional Simplified [pinyin] /def 1/def 2/
  const match = trimmed.match(/^(\S+)\s+(\S+)\s+\[(.*?)\]\s+\/(.*)\/$/);
  if (!match) return null;
  const [, traditional, simplified, pinyin, defs] = match;
  const rawDefs = defs.split('/').map(d => d.trim()).filter(d => d.length > 0);
  const filteredDefs = rawDefs.filter(d => !isMetadataSense(d));
  const definitions = filteredDefs.length > 0 ? filteredDefs : rawDefs;
  return { traditional, simplified, pinyin, definitions };
}

async function buildDict() {
  if (!fs.existsSync(DICT_DIR)) {
    fs.mkdirSync(DICT_DIR, { recursive: true });
  }

  const dict: Record<string, { pinyin: string; definitions: string[] }> = { ...ESSENTIAL_DICT };

  console.log('Attempting to download and parse CC-CEDICT...');
  const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

  try {
    const res = await fetch(CEDICT_URL, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const decompressed = zlib.gunzipSync(buffer).toString('utf-8');
    const lines = decompressed.split('\n');
    let count = 0;
    for (const rawLine of lines) {
      const parsed = parseCedictLine(rawLine);
      if (parsed) {
        const existing = dict[parsed.simplified];
        if (!existing) {
          dict[parsed.simplified] = {
            pinyin: parsed.pinyin,
            definitions: parsed.definitions,
          };
        } else {
          // Prefer lowercase (common word) over capitalized (surname/proper noun) as primary sense
          const existingIsProper = /^[A-Z]/.test(existing.pinyin) || /^surname\b/i.test(existing.definitions[0] || '');
          const newIsProper = /^[A-Z]/.test(parsed.pinyin) || /^surname\b/i.test(parsed.definitions[0] || '');

          const primaryDefs = existingIsProper && !newIsProper ? parsed.definitions : existing.definitions;
          const secondaryDefs = existingIsProper && !newIsProper ? existing.definitions : parsed.definitions;
          const mergedDefs = Array.from(new Set([...primaryDefs, ...secondaryDefs]));

          dict[parsed.simplified] = {
            pinyin: existingIsProper && !newIsProper ? parsed.pinyin : existing.pinyin,
            definitions: mergedDefs,
          };
        }
        count++;
      }
    }
    console.log(`Parsed ${count} entries from CC-CEDICT!`);
  } catch (err) {
    console.warn('Network download of CC-CEDICT skipped/failed:', err);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dict));
  console.log(`Wrote dictionary with ${Object.keys(dict).length} entries to ${OUTPUT_FILE}`);
}

buildDict().catch(err => {
  console.error(err);
  process.exit(1);
});
