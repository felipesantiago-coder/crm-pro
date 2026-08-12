// Script to find potential BigInt mixing issues in report route
import { readFileSync } from 'fs';

const content = readFileSync('src/app/api/tracking/report/route.ts', 'utf-8');
const lines = content.split('\n');

// Fields that return BigInt from PostgreSQL ::bigint
const bigintFields = ['count', 'visitors', 'leads', 'events', 'pageviews', 'sessions', 'returning', 'new', 'unique_visitors', 'clicks'];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineNum = i + 1;
  
  // Skip comments and imports
  if (line.trim().startsWith('//') || line.trim().startsWith('import') || line.trim().startsWith('*')) continue;
  if (line.includes('safe(') || line.includes('catch') || line.includes('console.')) continue;
  
  // Check for raw field usage in expressions (not wrapped in Number/fmt/etc)
  for (const field of bigintFields) {
    // Match patterns like: r.count, d.visitors, e.leads, etc. that are NOT inside Number()
    const regex = new RegExp(`(?<!Number\\()(?<!fmt\\()\\b([a-z])\\.${field}\\b(?!\\s*\\))`, 'g');
    let match;
    while ((match = regex.exec(line)) !== null) {
      // Check context: is this inside a template literal, arithmetic, or comparison?
      const before = line.substring(0, match.index);
      const after = line.substring(match.index + match[0].length);
      
      // If the line has arithmetic (+, *, /, -) nearby, it's likely a BigInt mixing issue
      if (/[+\-*/]/.test(after.substring(0, 5)) && !after.substring(0, 5).includes('++')) {
        console.log(`Line ${lineNum}: Possible BigInt arithmetic: ${match[0]} → ${line.trim()}`);
      }
      
      // If used in template literal without Number() or fmt()
      if (before.includes('${') && !before.includes('Number(') && !before.includes('fmt(')) {
        console.log(`Line ${lineNum}: Possible BigInt in template: ${match[0]} → ${line.trim()}`);
      }
    }
  }
}
