// Prints the vitest coverage summary as a Markdown table (CI job summary).
import fs from 'node:fs';

const file = process.argv[2] || 'coverage/coverage-summary.json';
const { total } = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = ['lines', 'statements', 'functions', 'branches'].map((k) => `| ${k} | ${total[k].pct}% | ${total[k].covered}/${total[k].total} |`);
console.log(['### Frontend coverage (logic layer)', '', '| Metric | Covered | Count |', '|---|---|---|', ...rows].join('\n'));
